import { bboxAreaSphereKm2, bboxAround, haversine, isValidBBox, type BBox, type LatLon } from '../geo/geo.ts'
import { CODEC_VERSION, CorruptDataError, decodeOsm, type CompactOsm } from './codec.ts'
import { isFresh, type AreaCache } from './cache.ts'
import { DownloadError, downloadArea, type FetchLike } from './download.ts'
import type { WorkerMessage, WorkerRequest } from './download.worker.ts'
import type { OsmData } from './types.ts'

/** Public mirrors asked in parallel (one request each); the first good answer wins. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/** Wait at least this long between two requests from this tab. */
export const MIN_REQUEST_GAP_MS = 10_000
/** Refuse areas larger than this (km²) so one walk never asks for a whole city. */
export const MAX_AREA_KM2 = 36

export type OverpassErrorCode = 'busy' | 'tooLarge' | 'network' | 'badResponse' | 'rateLimited' | 'badArea'

export class OverpassError extends Error {
  readonly code: OverpassErrorCode
  constructor(code: OverpassErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** Area of a box on the sphere in km² (exact; NaN for a NaN box, so check {@link isValidBBox} first). */
export function bboxAreaKm2(b: BBox): number {
  return bboxAreaSphereKm2(b)
}

/** Cache grid in degrees: about 111 m of latitude. */
const GRID = 1000
/** Float noise guard so 39.48 (stored as 39.4799999…) stays on its own grid line. */
const EPS = 1e-7

/**
 * Grow a box outwards to the cache grid (0.001°, about 100 m). The downloaded
 * area is this box, so a cache entry always covers every request that maps to
 * its key; rounding to the nearest line (as before) could leave up to 50 m of
 * a request outside the data.
 */
export function snapBBox(b: BBox): BBox {
  const down = (v: number) => Math.floor(v * GRID + EPS) / GRID
  const up = (v: number) => Math.ceil(v * GRID - EPS) / GRID
  return { south: down(b.south), west: down(b.west), north: up(b.north), east: up(b.east) }
}

/**
 * Cache key of an area: the codec version (a new format retires old entries
 * without reading them) and the box snapped outwards to ~100 m.
 */
export function cacheKey(b: BBox): string {
  const s = snapBBox(b)
  const r = (v: number) => v.toFixed(3)
  return `v${CODEC_VERSION}:${r(s.south)},${r(s.west)},${r(s.north)},${r(s.east)}`
}

/**
 * Area to download for a walk: big enough for the loop or detour, plus a margin.
 * A loop of length L stays within about L / 2π of its start (streets add ~30 %),
 * so a tighter box downloads far less (about half the area of the earlier one).
 * The radius is capped at 2.85 km so that the box, grown to the cache grid, stays
 * inside {@link MAX_AREA_KM2}.
 */
export function areaForWalk(start: LatLon, targetM: number, end?: LatLon): BBox {
  if (!end) return bboxAround(start, Math.min(MAX_WALK_RADIUS_M, targetM / (2 * Math.PI) * 1.3 + 250))
  const mid = { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 }
  const half = haversine(start, end) / 2
  const detour = Math.max(0, targetM / 2 - half) / 1.3
  return bboxAround(mid, Math.min(MAX_WALK_RADIUS_M, half + detour + 300))
}

const MAX_WALK_RADIUS_M = 2850

export type Downloader = (bbox: BBox, onProgress?: (bytes: number) => void) => Promise<CompactOsm>

export type OverpassClientOptions = {
  cache: AreaCache
  /** In-thread download with this fetch (tests); otherwise a Web Worker when available. */
  fetch?: FetchLike
  download?: Downloader
  now?: () => number
  endpoints?: string[]
}

/** Loaded areas (key, bbox, time) so a smaller area inside a cached one needs no download. */
const INDEX_KEY = 'stepquest.areaIndex'
const MAX_INDEX = 40
type IndexEntry = { key: string; bbox: [number, number, number, number]; savedAt: number }

const isIndexEntry = (e: unknown): e is IndexEntry => {
  if (!e || typeof e !== 'object') return false
  const { key, bbox, savedAt } = e as Partial<IndexEntry>
  return typeof key === 'string' && typeof savedAt === 'number' && Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => typeof v === 'number' && Number.isFinite(v))
}

/** Index entries from storage; damaged JSON or foreign entries are dropped one by one. */
function readIndex(): IndexEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter(isIndexEntry) : []
  } catch {
    return []
  }
}

function writeIndex(entries: IndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or blocked: the exact-key cache still works.
  }
}

const contains = (outer: IndexEntry['bbox'], b: BBox) => outer[0] <= b.south && outer[1] <= b.west && outer[2] >= b.north && outer[3] >= b.east

/** Runs the download in a Web Worker (parsing megabytes of JSON off the main thread). */
function workerDownloader(endpoints: string[]): Downloader {
  return (bbox, onProgress) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./download.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data
        if (m.type === 'progress') return onProgress?.(m.bytes)
        worker.terminate()
        if (m.type === 'done') resolve(m.data)
        else reject(new DownloadError(m.code, m.message))
      }
      worker.onerror = (e) => {
        worker.terminate()
        reject(new DownloadError('network', e.message))
      }
      worker.postMessage({ bbox, endpoints } satisfies WorkerRequest)
    })
}

/**
 * Polite Overpass client: cache first (also reusing a cached area that covers
 * the request), one download at a time, a minimum gap between downloads, and
 * one request to each mirror at once, keeping the first good answer. Browsers
 * send their own Referer and User-Agent, which identifies the app per the
 * Overpass usage policy.
 */
export class OverpassClient {
  private readonly cache: AreaCache
  private readonly now: () => number
  private readonly download: Downloader
  private inFlight = false
  private lastRequestAt = -Infinity
  private retiredOldVersions = false

  constructor(options: OverpassClientOptions) {
    this.cache = options.cache
    this.now = options.now ?? (() => Date.now())
    const endpoints = options.endpoints ?? OVERPASS_ENDPOINTS
    const fetchFn = options.fetch
    this.download =
      options.download ??
      (fetchFn || typeof Worker === 'undefined'
        ? (bbox, onProgress) => downloadArea(bbox, { endpoints, fetch: fetchFn ?? ((input, init) => fetch(input, init)), onProgress })
        : workerDownloader(endpoints))
  }

  /** Decode a stored entry; a damaged or foreign one is deleted and counts as a miss. */
  private async readEntry(key: string): Promise<OsmData | undefined> {
    const entry = await this.cache.get(key).catch(() => undefined)
    if (!entry || !isFresh(entry.savedAt, this.now())) return undefined
    try {
      return decodeOsm(entry.data)
    } catch {
      await this.cache.delete?.(key).catch(() => undefined)
      return undefined
    }
  }

  private async cached(bbox: BBox): Promise<OsmData | undefined> {
    const exact = await this.readEntry(cacheKey(bbox))
    if (exact) return exact
    for (const entry of readIndex().reverse()) {
      if (!isFresh(entry.savedAt, this.now()) || !contains(entry.bbox, bbox)) continue
      const hit = await this.readEntry(entry.key)
      if (hit) return hit
    }
    return undefined
  }

  /**
   * Housekeeping after a save, once per session: forget index entries that
   * expired or fell off the end of the index (and delete their data), and
   * delete entries written under an older cache version. Local storage only,
   * never a network request; failures are ignored.
   */
  private async prune(index: IndexEntry[]): Promise<IndexEntry[]> {
    const live = index.filter((e) => isFresh(e.savedAt, this.now()))
    const kept = live.slice(-MAX_INDEX)
    const gone = new Set(index.filter((e) => !kept.includes(e)).map((e) => e.key))
    const del = this.cache.delete?.bind(this.cache)
    if (del) {
      for (const key of gone) if (!kept.some((e) => e.key === key)) await del(key).catch(() => undefined)
      if (!this.retiredOldVersions && this.cache.keys) {
        this.retiredOldVersions = true
        const prefix = `v${CODEC_VERSION}:`
        for (const key of await this.cache.keys().catch(() => [] as string[])) if (!key.startsWith(prefix)) await del(key).catch(() => undefined)
      }
    }
    return kept
  }

  /**
   * Load an area: from the cache when a fresh entry covers it, otherwise one
   * download of the box snapped to the cache grid ({@link snapBBox}). Throws
   * {@link OverpassError} with a code the UI can translate.
   */
  async loadArea(request: BBox, onProgress?: (bytes: number) => void): Promise<{ data: OsmData; fromCache: boolean }> {
    if (!isValidBBox(request)) throw new OverpassError('badArea', 'Invalid area')
    const cached = await this.cached(request)
    if (cached) return { data: cached, fromCache: true }
    const bbox = snapBBox(request)
    if (!isValidBBox(bbox)) throw new OverpassError('badArea', 'Invalid area')
    if (bboxAreaKm2(bbox) > MAX_AREA_KM2) throw new OverpassError('tooLarge', 'Area too large')
    if (this.inFlight) throw new OverpassError('busy', 'A map download is already running')
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - this.now()
    if (wait > 0) throw new OverpassError('rateLimited', `Wait ${Math.ceil(wait / 1000)} s`)

    this.inFlight = true
    this.lastRequestAt = this.now()
    try {
      const compact = await this.download(bbox, onProgress)
      // Decode first: an answer we cannot read is never cached.
      const data = decodeOsm(compact)
      const key = cacheKey(bbox)
      const savedAt = this.now()
      const saved = await this.cache.set(key, { savedAt, data: compact }).then(
        () => true,
        () => false,
      )
      if (saved) writeIndex(await this.prune([...readIndex().filter((e) => e.key !== key), { key, bbox: [bbox.south, bbox.west, bbox.north, bbox.east], savedAt }]))
      return { data, fromCache: false }
    } catch (error) {
      if (error instanceof DownloadError) throw new OverpassError(error.code, error.message)
      throw new OverpassError(error instanceof CorruptDataError ? 'badResponse' : 'network', error instanceof Error ? error.message : String(error))
    } finally {
      this.inFlight = false
    }
  }
}
