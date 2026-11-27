import { CODEC_VERSION, CorruptDataError, decodeOsm, encodeOsm, type StoredOsm } from '../osm/codec.ts'
import { CACHE_READ_TIMEOUT_MS, CACHE_WRITE_TIMEOUT_MS, isFresh, pruneEntries, readEntryIndex, within, type AreaCache, type IndexEntry } from '../osm/cache.ts'
import type { WorkerMessage, WorkerRequest } from '../osm/download.worker.ts'
import type { FetchLike } from '../osm/download.ts'
import type { OsmData } from '../osm/types.ts'
import { DETAIL_Z } from './assemble.ts'
import { fetchTileBytes, TileError, TILE_TIMEOUT_MS } from './fetchTile.ts'
import { isLodTile, tileToLod, type LodTile } from '../lod/tile.ts'
import { tileToOsm } from './omt.ts'
import { tileKey, type TileId } from './tileMath.ts'

export { TileError }

/** OpenFreeMap's TileJSON: names the current tileset (its URL has a version in the path that changes with each planet build). */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
/** The TileJSON is read again after a day; a stale one is still used when the read fails. */
export const TILEJSON_TTL_MS = 24 * 60 * 60 * 1000
export const TILEJSON_TIMEOUT_MS = 8_000
const TILEJSON_KEY = 'stepquest.tilejson'
/** Tile downloads at once from this tab (requirement 21.8): OpenFreeMap asks for at most 4 parallel requests (openfreemap.org, quick start). */
export const MAX_TILES_IN_FLIGHT = 4
/** No tile holds its slot longer than this, whatever the worker or the network do. */
export const TILE_DEADLINE_MS = 25_000
/** Tiles kept in IndexedDB; oldest saved go first. A dense z14 tile is 0.4 to 0.9 MB in the compact form (measured over València), so about 50 MB at most. */
export const MAX_TILE_ENTRIES = 60
const TILE_INDEX_KEY = 'stepquest.tileIndex'
/** LOD tiles kept in IndexedDB (requirement 25.9); one is about 100 KB, so 320 are about 30 MB at most. */
export const MAX_LOD_ENTRIES = 320
const LOD_INDEX_KEY = 'stepquest.lodIndex'

export const tileCacheKey = (t: TileId): string => `v${CODEC_VERSION}:mvt:${tileKey(t)}`
export const lodPrefix = `lod${CODEC_VERSION}:`
export const lodCacheKey = (t: TileId): string => `${lodPrefix}${tileKey(t)}`

/** Tiles below the detail zoom are kept to their coarse layer (requirement 21.4). */
export const isCoarseTile = (t: TileId): boolean => t.z < DETAIL_Z

type TileJson = { tiles: string; maxzoom: number; savedAt: number }

export type TileClientOptions = {
  cache: AreaCache
  /** In-thread fetch and decode (tests); otherwise a Web Worker when available. */
  fetch?: FetchLike
  now?: () => number
  tileJsonUrl?: string
}

/** What the streamer needs from a tile source. */
export type TileSource = Pick<VectorTileClient, 'loadTile' | 'cachedTile' | 'busy'>
/** What the LOD prefetcher needs from the tile client (requirement 25.8). */
export type LodSource = Pick<VectorTileClient, 'loadLod' | 'cachedLod' | 'busy' | 'running' | 'lodWireBytes'>

/**
 * Vector tiles from OpenFreeMap (requirement 21): cache first (IndexedDB, 7 days, plus the browser's
 * own HTTP cache, which the CDN allows for years), at most `MAX_TILES_IN_FLIGHT` downloads, a hard
 * deadline per tile, decoding and conversion in a worker. The tile URL comes from the TileJSON read
 * at run time, never from a version written into the code.
 */
export class VectorTileClient {
  private readonly cache: AreaCache
  private readonly now: () => number
  private readonly fetchFn: FetchLike | undefined
  private readonly tileJsonUrl: string
  private tileJson: TileJson | undefined
  private tileJsonLoad: Promise<TileJson> | undefined
  private inFlight = 0
  private worker: Worker | undefined
  private nextId = 1
  private readonly waiting = new Map<number, { resolve: (d: never) => void; reject: (e: unknown) => void }>()
  private tail: Promise<void> = Promise.resolve()
  private readonly writes = new Set<Promise<void>>()
  /** Tiles downloaded (diagnostics and tests). */
  downloads = 0
  /** LOD tiles downloaded, and the raw tile bytes they came in (requirement 25.8 caps the rings by these). */
  lodDownloads = 0
  lodWireBytes = 0

  constructor(options: TileClientOptions) {
    this.cache = options.cache
    this.now = options.now ?? (() => Date.now())
    this.fetchFn = options.fetch
    this.tileJsonUrl = options.tileJsonUrl ?? TILEJSON_URL
  }

  get busy(): boolean {
    return this.inFlight >= MAX_TILES_IN_FLIGHT
  }

  get running(): number {
    return this.inFlight
  }

  /** The tile URL template: memory, then storage (fresh), then the network, then storage (stale). */
  async template(): Promise<TileJson> {
    if (this.tileJson && this.now() - this.tileJson.savedAt < TILEJSON_TTL_MS) return this.tileJson
    const stored = readTileJson()
    if (stored && this.now() - stored.savedAt < TILEJSON_TTL_MS) return (this.tileJson = stored)
    this.tileJsonLoad ??= this.fetchTileJson().finally(() => (this.tileJsonLoad = undefined))
    try {
      return (this.tileJson = await this.tileJsonLoad)
    } catch (error) {
      if (stored) return (this.tileJson = stored)
      throw error
    }
  }

  private async fetchTileJson(): Promise<TileJson> {
    const fetchFn = this.fetchFn ?? ((input: string, init?: RequestInit) => fetch(input, init))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TILEJSON_TIMEOUT_MS)
    try {
      const res = await fetchFn(this.tileJsonUrl, { signal: controller.signal }).catch((e: unknown) => {
        throw new TileError('network', e instanceof Error ? e.message : String(e))
      })
      if (!res.ok) throw new TileError(res.status === 429 ? 'rateLimited' : 'network', `TileJSON answered ${res.status}`)
      const json = (await res.json().catch(() => undefined)) as { tiles?: unknown; maxzoom?: unknown } | undefined
      const tiles = Array.isArray(json?.tiles) ? json.tiles[0] : undefined
      if (typeof tiles !== 'string' || !/^https:\/\/.*\{z\}.*\{x\}.*\{y\}/.test(tiles)) throw new TileError('badResponse', 'TileJSON without a tile URL')
      const tj: TileJson = { tiles, maxzoom: typeof json?.maxzoom === 'number' ? json.maxzoom : DETAIL_Z, savedAt: this.now() }
      try {
        localStorage.setItem(TILEJSON_KEY, JSON.stringify(tj))
      } catch {
        // Storage blocked: the template is kept for this session only.
      }
      return tj
    } finally {
      clearTimeout(timer)
    }
  }

  /** A cached tile, or undefined (missing, expired, damaged: a damaged entry is deleted). Local only. */
  async cachedTile(t: TileId): Promise<OsmData | undefined> {
    const key = tileCacheKey(t)
    const entry = await within(this.cache.get(key), CACHE_READ_TIMEOUT_MS, undefined)
    if (!entry || !isFresh(entry.savedAt, this.now())) return undefined
    try {
      return decodeOsm(entry.data)
    } catch {
      await this.cache.delete?.(key).catch(() => undefined)
      return undefined
    }
  }

  /** Load a tile: cache first, then one download (refused as `busy` when every slot is taken). Throws `TileError`. */
  async loadTile(t: TileId): Promise<OsmData> {
    const hit = await this.cachedTile(t)
    if (hit) return hit
    if (this.busy) throw new TileError('busy', 'Every tile slot is taken')
    this.inFlight++
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const tj = await this.template()
      if (t.z > tj.maxzoom || t.z < 0) throw new TileError('badResponse', 'No such zoom')
      const url = tj.tiles.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new TileError('network', 'The tile took too long')), TILE_DEADLINE_MS)
      })
      const compact = await Promise.race([this.download(url, t), timedOut])
      const data = decodeOsm(compact)
      this.downloads++
      this.later(t, compact)
      return data
    } catch (error) {
      if (error instanceof TileError) throw error
      throw new TileError(error instanceof CorruptDataError ? 'badResponse' : 'network', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(deadline)
      this.inFlight--
    }
  }

  /** A cached LOD tile, or undefined (missing, expired, damaged: a damaged entry is deleted). Local only. */
  async cachedLod(t: TileId): Promise<LodTile | undefined> {
    const key = lodCacheKey(t)
    const entry = await within(this.cache.get(key), CACHE_READ_TIMEOUT_MS, undefined)
    if (!entry || !isFresh(entry.savedAt, this.now())) return undefined
    const data = entry.data as unknown
    if (isLodTile(data)) return data
    await this.cache.delete?.(key).catch(() => undefined)
    return undefined
  }

  /** Load a LOD tile: device cache first, then one download of the raw tile (browser HTTP cache first), refused as `busy` when every slot is taken. Throws `TileError`. */
  async loadLod(t: TileId): Promise<LodTile> {
    const hit = await this.cachedLod(t)
    if (hit) return hit
    if (this.busy) throw new TileError('busy', 'Every tile slot is taken')
    this.inFlight++
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const tj = await this.template()
      if (t.z > tj.maxzoom || t.z < 0) throw new TileError('badResponse', 'No such zoom')
      const url = tj.tiles.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new TileError('network', 'The tile took too long')), TILE_DEADLINE_MS)
      })
      const got = await Promise.race([this.downloadLod(url, t), timedOut])
      this.lodDownloads++
      this.lodWireBytes += got.bytes
      this.laterLod(t, got.tile)
      return got.tile
    } catch (error) {
      if (error instanceof TileError) throw error
      throw new TileError('network', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(deadline)
      this.inFlight--
    }
  }

  private downloadLod(url: string, t: TileId): Promise<{ tile: LodTile; bytes: number }> {
    if (this.fetchFn || typeof Worker === 'undefined') {
      const fetchFn = this.fetchFn ?? ((input: string, init?: RequestInit) => fetch(input, init))
      return fetchTileBytes(url, fetchFn, { timeoutMs: TILE_TIMEOUT_MS }).then((bytes) => ({ tile: tileToLod(bytes, t), bytes: bytes.length }))
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.waiting.set(id, { resolve: (d: { tile: LodTile; bytes: number }) => resolve(d) as never, reject })
      this.workerOnce().postMessage({ type: 'lod', id, url, tile: t } satisfies WorkerRequest)
    })
  }

  /** Save a LOD tile after it was handed over, in the same one-job-at-a-time line as the full tiles. */
  private laterLod(t: TileId, tile: LodTile): void {
    const key = lodCacheKey(t)
    const savedAt = this.now()
    const p = this.tail
      .then(async () => {
        const ok = await within(this.cache.set(key, { savedAt, data: tile as unknown as StoredOsm }).then(() => true), CACHE_WRITE_TIMEOUT_MS, false)
        if (!ok) return
        const index: IndexEntry[] = [...readEntryIndex(LOD_INDEX_KEY).filter((e) => e.key !== key), { key, savedAt }]
        await pruneEntries(this.cache, LOD_INDEX_KEY, MAX_LOD_ENTRIES, index, this.now(), lodPrefix)
      })
      .catch(() => undefined)
    this.tail = p
    this.writes.add(p)
    void p.finally(() => this.writes.delete(p))
  }

  private download(url: string, t: TileId): Promise<StoredOsm> {
    const coarse = isCoarseTile(t)
    if (this.fetchFn || typeof Worker === 'undefined') {
      const fetchFn = this.fetchFn ?? ((input: string, init?: RequestInit) => fetch(input, init))
      return fetchTileBytes(url, fetchFn, { timeoutMs: TILE_TIMEOUT_MS }).then((bytes) => encodeOsm(tileToOsm(bytes, t, { coarse })))
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.waiting.set(id, { resolve: resolve as (d: never) => void, reject })
      this.workerOnce().postMessage({ type: 'tile', id, url, tile: t, coarse } satisfies WorkerRequest)
    })
  }

  /** One worker serves every tile; it is made on first use and made again after a crash. */
  private workerOnce(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('../osm/download.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data
      if (m.type !== 'tile' && m.type !== 'tileError' && m.type !== 'lod') return
      const job = this.waiting.get(m.id)
      if (!job) return
      this.waiting.delete(m.id)
      if (m.type === 'tile') job.resolve(m.data as never)
      else if (m.type === 'lod') job.resolve({ tile: m.data, bytes: m.bytes } as never)
      else job.reject(new TileError(m.code, m.message))
    }
    w.onerror = (e) => {
      for (const job of this.waiting.values()) job.reject(new TileError('network', e.message))
      this.waiting.clear()
      w.terminate()
      if (this.worker === w) this.worker = undefined
    }
    return (this.worker = w)
  }

  /** Save a tile after it was handed over (arrival never waits for IndexedDB), one job at a time. */
  private later(t: TileId, compact: StoredOsm): void {
    const key = tileCacheKey(t)
    const savedAt = this.now()
    const p = this.tail
      .then(async () => {
        const ok = await within(this.cache.set(key, { savedAt, data: compact }).then(() => true), CACHE_WRITE_TIMEOUT_MS, false)
        if (!ok) return
        const index: IndexEntry[] = [...readEntryIndex(TILE_INDEX_KEY).filter((e) => e.key !== key), { key, savedAt }]
        await pruneEntries(this.cache, TILE_INDEX_KEY, MAX_TILE_ENTRIES, index, this.now())
      })
      .catch(() => undefined)
    this.tail = p
    this.writes.add(p)
    void p.finally(() => this.writes.delete(p))
  }

  /** Resolves when every pending cache write is done (tests). */
  async settled(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes])
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = undefined
    for (const job of this.waiting.values()) job.reject(new TileError('network', 'Closed'))
    this.waiting.clear()
  }
}

function readTileJson(): TileJson | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(TILEJSON_KEY) ?? 'null') as Partial<TileJson> | null
    if (raw && typeof raw.tiles === 'string' && typeof raw.savedAt === 'number' && typeof raw.maxzoom === 'number') return raw as TileJson
  } catch {
    // Damaged: read again from the network.
  }
  return undefined
}

