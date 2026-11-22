import { bboxAround, haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { decodeOsm, type CompactOsm } from './codec.ts'
import { CACHE_TTL_MS, type AreaCache } from './cache.ts'
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

export type OverpassErrorCode = 'busy' | 'tooLarge' | 'network' | 'badResponse' | 'rateLimited'

export class OverpassError extends Error {
  readonly code: OverpassErrorCode
  constructor(code: OverpassErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function bboxAreaKm2(b: BBox): number {
  const w = haversine({ lat: b.south, lon: b.west }, { lat: b.south, lon: b.east })
  const h = haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.west })
  return (w * h) / 1e6
}

/** Round to ~100 m so nearby requests share one cache entry. */
export function cacheKey(b: BBox): string {
  const r = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)
  return `v3:${r(b.south)},${r(b.west)},${r(b.north)},${r(b.east)}`
}

/**
 * Area to download for a walk: big enough for the loop or detour, plus a margin.
 * A loop of length L stays within about L / 2π of its start (streets add ~30 %),
 * so a tighter box downloads far less (about half the area of the earlier one).
 */
export function areaForWalk(start: LatLon, targetM: number, end?: LatLon): BBox {
  if (!end) return bboxAround(start, Math.min(3000, targetM / (2 * Math.PI) * 1.3 + 250))
  const mid = { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 }
  const half = haversine(start, end) / 2
  const detour = Math.max(0, targetM / 2 - half) / 1.3
  return bboxAround(mid, Math.min(3000, half + detour + 300))
}

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

function readIndex(): IndexEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? (raw as IndexEntry[]) : []
  } catch {
    return []
  }
}

function writeIndex(entries: IndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries.slice(-MAX_INDEX)))
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

  private async cached(bbox: BBox): Promise<OsmData | undefined> {
    const fresh = (e: { savedAt: number } | undefined) => !!e && this.now() - e.savedAt < CACHE_TTL_MS
    const exact = await this.cache.get(cacheKey(bbox)).catch(() => undefined)
    if (exact && fresh(exact)) return decodeOsm(exact.data)
    for (const entry of readIndex().reverse()) {
      if (!fresh(entry) || !contains(entry.bbox, bbox)) continue
      const hit = await this.cache.get(entry.key).catch(() => undefined)
      if (hit && fresh(hit)) return decodeOsm(hit.data)
    }
    return undefined
  }

  async loadArea(bbox: BBox, onProgress?: (bytes: number) => void): Promise<{ data: OsmData; fromCache: boolean }> {
    const cached = await this.cached(bbox)
    if (cached) return { data: cached, fromCache: true }
    if (bboxAreaKm2(bbox) > MAX_AREA_KM2) throw new OverpassError('tooLarge', 'Area too large')
    if (this.inFlight) throw new OverpassError('busy', 'A map download is already running')
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - this.now()
    if (wait > 0) throw new OverpassError('rateLimited', `Wait ${Math.ceil(wait / 1000)} s`)

    this.inFlight = true
    this.lastRequestAt = this.now()
    try {
      const compact = await this.download(bbox, onProgress)
      const key = cacheKey(bbox)
      const savedAt = this.now()
      await this.cache.set(key, { savedAt, data: compact }).catch(() => undefined)
      writeIndex([...readIndex().filter((e) => e.key !== key), { key, bbox: [bbox.south, bbox.west, bbox.north, bbox.east], savedAt }])
      return { data: decodeOsm(compact), fromCache: false }
    } catch (error) {
      if (error instanceof DownloadError) throw new OverpassError(error.code, error.message)
      throw new OverpassError('network', error instanceof Error ? error.message : String(error))
    } finally {
      this.inFlight = false
    }
  }
}
