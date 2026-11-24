import { bboxAreaSphereKm2, bboxAround, haversine, isValidBBox, type BBox, type LatLon } from '../geo/geo.ts'
import { cellBBox, cellKey, cellsBBox, isValidCell, type CellId } from '../world/cells.ts'
import { sliceToCells, type CellRecord } from '../world/slice.ts'
import { CODEC_VERSION, CorruptDataError, decodeOsm, encodeOsm, type CompactOsm } from './codec.ts'
import { CACHE_READ_TIMEOUT_MS, CACHE_WRITE_TIMEOUT_MS, isFresh, pruneEntries, readEntryIndex, within, type AreaCache, type CacheEntry, type IndexEntry as CellIndexEntry } from './cache.ts'
import { DownloadError, downloadArea, type FetchLike } from './download.ts'
import type { WorkerMessage, WorkerRequest } from './download.worker.ts'
import type { OsmData } from './types.ts'

/** Public mirrors asked in parallel (one request each); the first good answer wins. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/** Wait at least this long between the starts of two requests from this tab (requirement 20.7). */
export const MIN_REQUEST_GAP_MS = 1_500
/** At most this many downloads run at once from this tab (an explicit area download runs alone). */
export const MAX_IN_FLIGHT = 2
/** No download is allowed to hold its slot longer than this, whatever the worker or the mirrors do (requirement 20.9). */
export const REQUEST_DEADLINE_MS = 75_000
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

/** Cache key of one data cell (requirement 19.6). */
export function cellCacheKey(c: CellId): string {
  return `v${CODEC_VERSION}:cell:${cellKey(c)}`
}

/** At most this many cells are kept in IndexedDB; the oldest saved go first (local deletes only). */
export const MAX_CELL_ENTRIES = 300
const CELL_INDEX_KEY = 'stepquest.cellIndex'

/** What `loadCells` gives back: one record per cell asked for, and where each came from. */
export type CellsResult = { records: CellRecord[]; cached: CellId[]; downloaded: CellId[] }

/** What a download needs besides the box: progress, a way to cancel it, which query to send and the mirror order. */
export type DownloadExtras = { signal?: AbortSignal; endpoints?: readonly string[]; onMirror?: (endpoint: string) => void }

export type Downloader = (bbox: BBox, onProgress?: (bytes: number) => void, extras?: DownloadExtras) => Promise<CompactOsm>

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

/** Runs the download in a Web Worker (parsing megabytes of JSON off the main thread). Aborting ends the worker. */
function workerDownloader(): Downloader {
  return (bbox, onProgress, extras) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./download.worker.ts', import.meta.url), { type: 'module' })
      const end = () => {
        extras?.signal?.removeEventListener('abort', onAbort)
        worker.terminate()
      }
      const onAbort = () => {
        end()
        reject(new DownloadError('network', 'Download cancelled'))
      }
      extras?.signal?.addEventListener('abort', onAbort)
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data
        if (m.type === 'progress') return onProgress?.(m.bytes)
        if (m.type === 'mirror') return extras?.onMirror?.(m.endpoint)
        end()
        if (m.type === 'done') resolve(m.data)
        else if (m.type === 'error') reject(new DownloadError(m.code, m.message))
        else reject(new DownloadError('badResponse', 'Unexpected worker message'))
      }
      worker.onerror = (e) => {
        end()
        reject(new DownloadError('network', e.message))
      }
      worker.postMessage({ type: 'overpass', bbox, endpoints: [...(extras?.endpoints ?? OVERPASS_ENDPOINTS)] } satisfies WorkerRequest)
    })
}

/** Remembers which mirror answered last and asks it first; a mirror that failed goes to the back. */
export class MirrorOrder {
  private order: string[]
  constructor(endpoints: readonly string[]) {
    this.order = [...endpoints]
  }
  list(): string[] {
    return [...this.order]
  }
  good(endpoint: string): void {
    this.order = [endpoint, ...this.order.filter((e) => e !== endpoint)]
  }
  /** After a failed download the next one starts with another mirror. */
  rotate(): void {
    const [first, ...rest] = this.order
    if (first !== undefined) this.order = [...rest, first]
  }
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
  private inFlight = 0
  private exclusive = false
  private lastRequestAt = -Infinity
  private readonly mirrors: MirrorOrder
  private retiredOldVersions = false

  constructor(options: OverpassClientOptions) {
    this.cache = options.cache
    this.now = options.now ?? (() => Date.now())
    this.mirrors = new MirrorOrder(options.endpoints ?? OVERPASS_ENDPOINTS)
    const fetchFn = options.fetch
    this.download =
      options.download ??
      (fetchFn || typeof Worker === 'undefined'
        ? (bbox, onProgress, extras) =>
            downloadArea(bbox, {
              endpoints: extras?.endpoints ?? this.mirrors.list(),
              fetch: fetchFn ?? ((input, init) => fetch(input, init)),
              onProgress,
              signal: extras?.signal,
              onMirror: extras?.onMirror,
            })
        : workerDownloader())
  }

  private read(key: string) {
    return within(this.cache.get(key), CACHE_READ_TIMEOUT_MS, undefined)
  }

  private write(key: string, entry: CacheEntry): Promise<boolean> {
    return within(this.cache.set(key, entry).then(() => true), CACHE_WRITE_TIMEOUT_MS, false)
  }

  private readonly writes = new Set<Promise<void>>()
  private tail: Promise<void> = Promise.resolve()

  /** Run cache writes after the answer was handed over (arrival never waits for IndexedDB), one job at a time so the index stays right. */
  private later(work: () => Promise<void>): void {
    const p = this.tail.then(work).catch(() => undefined)
    this.tail = p
    this.writes.add(p)
    void p.finally(() => this.writes.delete(p))
  }

  /** Resolves when every pending cache write is done (tests). */
  async settled(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes])
  }

  /** Decode a stored entry; a damaged or foreign one is deleted and counts as a miss. */
  private async readEntry(key: string): Promise<OsmData | undefined> {
    const entry = await this.read(key)
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
    const { compact, data } = await this.fetchOnce(bbox, onProgress, { alone: true })
    const key = cacheKey(bbox)
    const savedAt = this.now()
    const saved = await this.write(key, { savedAt, data: compact })
    if (saved) writeIndex(await this.prune([...readIndex().filter((e) => e.key !== key), { key, bbox: [bbox.south, bbox.west, bbox.north, bbox.east], savedAt }]))
    return { data, fromCache: false }
  }

  /** Whether every download slot is taken (the streamer does not even ask then). */
  get busy(): boolean {
    return this.exclusive || this.inFlight >= MAX_IN_FLIGHT
  }

  /** Downloads running now. */
  get running(): number {
    return this.inFlight
  }

  /** Time (ms) until the spacing rule allows the next download to start; 0 when one may start now. */
  waitMs(): number {
    return Math.max(0, this.lastRequestAt + MIN_REQUEST_GAP_MS - this.now())
  }

  /**
   * The one place a request is sent: refuses while every slot is taken (`busy`; an area download
   * needs all of them) or before the gap since the last start is over (`rateLimited`), then
   * downloads and decodes under a hard deadline. The slot is freed when the deadline passes even if
   * the download never answers. An answer that cannot be decoded is `badResponse` and is never
   * cached by the callers. The mirror that answered is asked first next time.
   */
  private async fetchOnce(bbox: BBox, onProgress?: (bytes: number) => void, opts: { alone?: boolean } = {}): Promise<{ compact: CompactOsm; data: OsmData }> {
    if (this.busy || (opts.alone && this.inFlight > 0)) throw new OverpassError('busy', 'A map download is already running')
    const wait = this.waitMs()
    if (wait > 0) throw new OverpassError('rateLimited', `Wait ${Math.ceil(wait / 1000)} s`)
    this.inFlight++
    if (opts.alone) this.exclusive = true
    this.lastRequestAt = this.now()
    const controller = new AbortController()
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          controller.abort()
          reject(new OverpassError('network', 'The download took too long'))
        }, REQUEST_DEADLINE_MS)
      })
      const compact = await Promise.race([
        this.download(bbox, onProgress, { signal: controller.signal, endpoints: this.mirrors.list(), onMirror: (e) => this.mirrors.good(e) }),
        timedOut,
      ])
      // Decode first: an answer we cannot read is never cached.
      return { compact, data: decodeOsm(compact) }
    } catch (error) {
      this.mirrors.rotate()
      if (error instanceof OverpassError) throw error
      if (error instanceof DownloadError) throw new OverpassError(error.code, error.message)
      throw new OverpassError(error instanceof CorruptDataError ? 'badResponse' : 'network', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(deadline)
      controller.abort()
      this.inFlight--
      if (opts.alone) this.exclusive = false
    }
  }

  /** A cached cell, or undefined (missing, expired, damaged: a damaged entry is deleted). */
  async cachedCell(cell: CellId): Promise<CellRecord | undefined> {
    const key = cellCacheKey(cell)
    const entry = await this.read(key)
    if (!entry || !isFresh(entry.savedAt, this.now())) return undefined
    try {
      const data = decodeOsm(entry.data)
      const want = cellBBox(cell)
      // An entry must be for this cell (a foreign or shifted box is damage).
      if (Math.abs(data.bbox.south - want.south) > 1e-6 || Math.abs(data.bbox.west - want.west) > 1e-6 || Math.abs(data.bbox.north - want.north) > 1e-6 || Math.abs(data.bbox.east - want.east) > 1e-6) throw new CorruptDataError('cell box')
      return { cell, coverage: want, data: { ...data, bbox: want }, savedAt: entry.savedAt }
    } catch {
      await this.cache.delete?.(key).catch(() => undefined)
      return undefined
    }
  }

  /**
   * Load data cells (requirement 19): every cell is looked up in the cache first; the cells still
   * missing are fetched in ONE request for the box around them (the caller passes a small rectangle,
   * at most `MAX_BATCH_CELLS`), then the answer is cut into the cells and each is cached under its
   * own key. Same refusals as `loadArea` (`badArea`, `tooLarge`, `busy`, `rateLimited`, ...).
   */
  async loadCells(cells: readonly CellId[], onProgress?: (bytes: number) => void): Promise<CellsResult> {
    if (!cells.length || !cells.every(isValidCell)) throw new OverpassError('badArea', 'Invalid area')
    const records: CellRecord[] = []
    const cached: CellId[] = []
    const missing: CellId[] = []
    for (const c of cells) {
      const hit = await this.cachedCell(c)
      if (hit) {
        records.push(hit)
        cached.push(c)
      } else missing.push(c)
    }
    if (!missing.length) return { records, cached, downloaded: [] }
    const bbox = cellsBBox(missing)
    if (!isValidBBox(bbox)) throw new OverpassError('badArea', 'Invalid area')
    if (bboxAreaKm2(bbox) > MAX_AREA_KM2) throw new OverpassError('tooLarge', 'Area too large')
    const { data } = await this.fetchOnce(bbox, onProgress)
    const savedAt = this.now()
    const fresh = sliceToCells(data, missing, bbox, savedAt)
    this.later(async () => {
      const index = readEntryIndex(CELL_INDEX_KEY)
      const written: CellIndexEntry[] = []
      for (const rec of fresh) {
        const key = cellCacheKey(rec.cell)
        if (await this.write(key, { savedAt, data: encodeOsm(rec.data) })) written.push({ key, savedAt })
      }
      if (written.length) await this.pruneEntries(CELL_INDEX_KEY, MAX_CELL_ENTRIES, [...index.filter((e) => !written.some((w) => w.key === e.key)), ...written])
    })
    return { records: [...records, ...fresh], cached, downloaded: fresh.map((r) => r.cell) }
  }

  private pruneEntries(indexKey: string, max: number, index: CellIndexEntry[]): Promise<void> {
    return pruneEntries(this.cache, indexKey, max, index, this.now())
  }
}
