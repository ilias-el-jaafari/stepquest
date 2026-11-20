import { CACHE_DB_NAME } from '../config/brand.ts'
import type { CompactOsm } from './codec.ts'

export type CacheEntry = { savedAt: number; data: CompactOsm }

export interface AreaCache {
  get(key: string): Promise<CacheEntry | undefined>
  set(key: string, entry: CacheEntry): Promise<void>
}

/** One week: street layouts change slowly and Overpass asks clients to cache. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class MemoryCache implements AreaCache {
  private readonly map = new Map<string, CacheEntry>()
  async get(key: string) {
    return this.map.get(key)
  }
  async set(key: string, entry: CacheEntry) {
    this.map.set(key, entry)
  }
}

const STORE = 'areas'

/** IndexedDB-backed cache (map extracts are megabytes, too big for localStorage). */
export class IndexedDbCache implements AreaCache {
  private db: Promise<IDBDatabase> | undefined

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(CACHE_DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
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
    })
  }
}

export function defaultCache(): AreaCache {
  return typeof indexedDB === 'undefined' ? new MemoryCache() : new IndexedDbCache()
}
