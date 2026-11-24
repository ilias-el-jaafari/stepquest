import { CACHE_DB_NAME } from '../config/brand.ts'
import { CODEC_VERSION, type CompactOsm } from './codec.ts'

export type CacheEntry = { savedAt: number; data: CompactOsm }

export interface AreaCache {
  get(key: string): Promise<CacheEntry | undefined>
  set(key: string, entry: CacheEntry): Promise<void>
  /** Remove an entry (expired, evicted from the area index, or from an older cache version). Optional so simple caches still work. */
  delete?(key: string): Promise<void>
  /** Every stored key, used once per session to retire entries of older versions. */
  keys?(): Promise<string[]>
}

/** One week: street layouts change slowly and Overpass asks clients to cache. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Clocks can jump back; an entry "from the future" by more than this is not trusted. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000

/** Whether a saved-at time is still inside the TTL (and not implausibly in the future). */
export function isFresh(savedAt: unknown, now: number): boolean {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return false
  const age = now - savedAt
  return age >= -CLOCK_SKEW_MS && age < CACHE_TTL_MS
}

export class MemoryCache implements AreaCache {
  private readonly map = new Map<string, CacheEntry>()
  async get(key: string) {
    return this.map.get(key)
  }
  async set(key: string, entry: CacheEntry) {
    this.map.set(key, entry)
  }
  async delete(key: string) {
    this.map.delete(key)
  }
  async keys() {
    return [...this.map.keys()]
  }
}

const STORE = 'areas'

/** IndexedDB-backed cache (map extracts are megabytes, too big for localStorage). */
export class IndexedDbCache implements AreaCache {
  private db: Promise<IDBDatabase> | undefined

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(CACHE_DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => {
        // Another tab upgrading or the browser closing the connection: open again next time.
        req.result.onclose = () => (this.db = undefined)
        req.result.onversionchange = () => {
          req.result.close()
          this.db = undefined
        }
        resolve(req.result)
      }
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
      req.onblocked = () => reject(new Error('IndexedDB open blocked'))
    }).catch((error: unknown) => {
      // A failed open (private mode, blocked upgrade) must not be remembered for the whole session.
      this.db = undefined
      throw error
    })
    return this.db
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as CacheEntry | undefined)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(entry, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      // QuotaExceededError arrives as an abort: the caller treats a failed write as "not cached".
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })
  }

  async delete(key: string): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
    })
  }

  async keys(): Promise<string[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result.filter((k): k is string => typeof k === 'string'))
      req.onerror = () => reject(req.error ?? new Error('IndexedDB keys failed'))
    })
  }
}

export function defaultCache(): AreaCache {
  return typeof indexedDB === 'undefined' ? new MemoryCache() : new IndexedDbCache()
}

/** A cache read that takes longer than this counts as a miss; a write that takes longer counts as not saved (a stuck IndexedDB must not stop the map). */
export const CACHE_READ_TIMEOUT_MS = 2_000
export const CACHE_WRITE_TIMEOUT_MS = 5_000

/** `promise`, or `fallback` when it rejects or takes longer than `ms`. */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

/** One saved entry in a size-limited index kept in localStorage (cells, vector tiles). */
export type IndexEntry = { key: string; savedAt: number }

export function readEntryIndex(indexKey: string): IndexEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(indexKey) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((e): e is IndexEntry => !!e && typeof e === 'object' && typeof (e as IndexEntry).key === 'string' && typeof (e as IndexEntry).savedAt === 'number') : []
  } catch {
    return []
  }
}

export function writeEntryIndex(indexKey: string, entries: IndexEntry[]): void {
  try {
    localStorage.setItem(indexKey, JSON.stringify(entries))
  } catch {
    // Storage full or blocked: the entries are still cached, only pruning waits.
  }
}

/** Keep the newest `max` fresh entries of an index (current codec only) and delete the data of the rest. Local only, never a request. */
export async function pruneEntries(cache: AreaCache, indexKey: string, max: number, index: IndexEntry[], now: number, prefix = `v${CODEC_VERSION}:`): Promise<void> {
  const live = index.filter((e) => isFresh(e.savedAt, now) && e.key.startsWith(prefix))
  live.sort((a, b) => a.savedAt - b.savedAt)
  const kept = live.slice(-max)
  const keptKeys = new Set(kept.map((e) => e.key))
  if (cache.delete) for (const e of index) if (!keptKeys.has(e.key)) await cache.delete(e.key).catch(() => undefined)
  writeEntryIndex(indexKey, kept)
}
