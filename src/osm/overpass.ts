import { bboxAround, haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { decodeOsm, encodeOsm } from './codec.ts'
import { CACHE_TTL_MS, type AreaCache } from './cache.ts'
import { overpassQuery } from './demoArea.ts'
import { normalizeOverpass, type OverpassResponse } from './normalize.ts'
import type { OsmData } from './types.ts'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
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

/** Area to download for a walk: big enough for the loop or detour, plus a margin. */
export function areaForWalk(start: LatLon, targetM: number, end?: LatLon): BBox {
  if (!end) return bboxAround(start, Math.min(3000, targetM / (2 * Math.PI) * 1.8 + 300))
  const mid = { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 }
  const half = haversine(start, end) / 2
  const detour = Math.max(0, targetM / 2 - half) / 1.3
  return bboxAround(mid, Math.min(3000, half + detour + 300))
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type OverpassClientOptions = {
  cache: AreaCache
  fetch?: FetchLike
  now?: () => number
  endpoints?: string[]
}

/**
 * Polite Overpass client: cache first, one request at a time, a minimum gap
 * between requests, and a fallback endpoint. Browsers send their own Referer
 * and User-Agent, which identifies the app per the Overpass usage policy.
 */
export class OverpassClient {
  private readonly cache: AreaCache
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly endpoints: string[]
  private inFlight = false
  private lastRequestAt = -Infinity

  constructor(options: OverpassClientOptions) {
    this.cache = options.cache
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
    this.now = options.now ?? (() => Date.now())
    this.endpoints = options.endpoints ?? OVERPASS_ENDPOINTS
  }

  async loadArea(bbox: BBox): Promise<{ data: OsmData; fromCache: boolean }> {
    const key = cacheKey(bbox)
    const cached = await this.cache.get(key).catch(() => undefined)
    if (cached && this.now() - cached.savedAt < CACHE_TTL_MS) {
      return { data: decodeOsm(cached.data), fromCache: true }
    }
    if (bboxAreaKm2(bbox) > MAX_AREA_KM2) throw new OverpassError('tooLarge', 'Area too large')
    if (this.inFlight) throw new OverpassError('busy', 'A map download is already running')
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - this.now()
    if (wait > 0) throw new OverpassError('rateLimited', `Wait ${Math.ceil(wait / 1000)} s`)

    this.inFlight = true
    this.lastRequestAt = this.now()
    try {
      let lastError: OverpassError | undefined
      for (const endpoint of this.endpoints) {
        try {
          const response = await this.fetchFn(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
          })
          if (response.status === 429 || response.status === 504) {
            lastError = new OverpassError('rateLimited', `Overpass is busy (${response.status})`)
            continue
          }
          if (!response.ok) {
            lastError = new OverpassError('badResponse', `Overpass answered ${response.status}`)
            continue
          }
          const json = (await response.json()) as OverpassResponse
          if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
            lastError = new OverpassError('busy', json.remark)
            continue
          }
          const data = normalizeOverpass(json, bbox, 'overpass')
          await this.cache.set(key, { savedAt: this.now(), data: encodeOsm(data) }).catch(() => undefined)
          return { data, fromCache: false }
        } catch (error) {
          if (error instanceof OverpassError) throw error
          lastError = new OverpassError('network', error instanceof Error ? error.message : String(error))
        }
      }
      throw lastError ?? new OverpassError('network', 'No Overpass endpoint answered')
    } finally {
      this.inFlight = false
    }
  }
}
