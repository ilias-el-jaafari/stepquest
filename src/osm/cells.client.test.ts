import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cellBBox } from '../world/cells.ts'
import { MemoryCache, CACHE_TTL_MS, type CacheEntry } from './cache.ts'
import { encodeOsm } from './codec.ts'
import { normalizeOverpass, type OverpassResponse } from './normalize.ts'
import { cellCacheKey, MAX_CELL_ENTRIES, MAX_IN_FLIGHT, MIN_REQUEST_GAP_MS, OverpassClient, type Downloader } from './overpass.ts'
import type { BBox } from '../geo/geo.ts'

const A = { i: 3949, j: -40 }
const B = { i: 3949, j: -39 }
const g = (lat: number, lon: number) => ({ lat, lon })

/** An answer with one street that crosses the border between A and B (whole, like `out geom`). */
function answer(): OverpassResponse {
  return {
    osm3s: { timestamp_osm_base: '2026-11-22T00:00:00Z' },
    elements: [
      { type: 'way', id: 1, tags: { highway: 'residential' }, nodes: [1, 2, 3], geometry: [g(39.495, -0.395), g(39.495, -0.39), g(39.495, -0.385)] },
      { type: 'way', id: 2, tags: { highway: 'footway' }, nodes: [4, 5], geometry: [g(39.492, -0.398), g(39.493, -0.397)] },
    ],
  }
}

function fakeDownloader() {
  const calls: BBox[] = []
  const download: Downloader = async (bbox) => {
    calls.push(bbox)
    return encodeOsm(normalizeOverpass(answer(), bbox))
  }
  return { calls, download }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('OverpassClient.loadCells (19.6, 19.7, 20.7, 20.9)', () => {
  it('fetches missing cells in one request for their box and cuts the answer per cell', async () => {
    const { calls, download } = fakeDownloader()
    const client = new OverpassClient({ cache: new MemoryCache(), download })
    const res = await client.loadCells([A, B])
    expect(calls).toEqual([{ south: 39.49, west: -0.4, north: 39.5, east: -0.38 }])
    expect(res.downloaded).toEqual([A, B])
    expect(res.records.map((r) => r.data.ways.map((w) => w.id))).toEqual([[1, 2], [1]])
    expect(res.records[0]!.coverage).toEqual(cellBBox(A))
  })

  it('serves cached cells without a request, and asks only for the rest', async () => {
    const { calls, download } = fakeDownloader()
    const cache = new MemoryCache()
    const client = new OverpassClient({ cache, download })
    await client.loadCells([A])
    await client.settled()
    vi.advanceTimersByTime(MIN_REQUEST_GAP_MS)
    const res = await client.loadCells([A, B])
    expect(res.cached).toEqual([A])
    expect(res.downloaded).toEqual([B])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(cellBBox(B))
    await client.settled()
    vi.advanceTimersByTime(MIN_REQUEST_GAP_MS)
    const again = await client.loadCells([A, B])
    expect(again.downloaded).toEqual([])
    expect(calls).toHaveLength(2)
    expect(await cache.get(cellCacheKey(A))).toBeDefined()
  })

  it('runs at most MAX_IN_FLIGHT downloads, starts them at least MIN_REQUEST_GAP_MS apart, and refuses the rest', async () => {
    const releases: (() => void)[] = []
    const download: Downloader = (bbox) =>
      new Promise((resolve) => {
        releases.push(() => resolve(encodeOsm(normalizeOverpass(answer(), bbox))))
      })
    const client = new OverpassClient({ cache: new MemoryCache(), download })
    const first = client.loadCells([A])
    await vi.advanceTimersByTimeAsync(0)
    expect(client.running).toBe(1)
    expect(client.busy).toBe(false)
    // The second may start, but not inside the gap.
    await expect(client.loadCells([B])).rejects.toMatchObject({ code: 'rateLimited' })
    expect(client.waitMs()).toBe(MIN_REQUEST_GAP_MS)
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_GAP_MS)
    const second = client.loadCells([B])
    await vi.advanceTimersByTimeAsync(0)
    expect(client.running).toBe(MAX_IN_FLIGHT)
    expect(client.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_GAP_MS)
    await expect(client.loadCells([{ i: 3949, j: -38 }])).rejects.toMatchObject({ code: 'busy' })
    // An explicit area download needs the client to itself.
    releases[0]!()
    await first
    await expect(client.loadArea({ south: 39.5, west: -0.4, north: 39.51, east: -0.39 })).rejects.toMatchObject({ code: 'busy' })
    releases[1]!()
    await expect(second).resolves.toMatchObject({ downloaded: [B] })
    expect(client.running).toBe(0)
  })

  it('passes 429 through as rateLimited and caches nothing', async () => {
    const cache = new MemoryCache()
    const client = new OverpassClient({ cache, fetch: async () => new Response('', { status: 429 }), endpoints: ['https://a.test/'] })
    await expect(client.loadCells([A])).rejects.toMatchObject({ code: 'rateLimited' })
    expect(await cache.keys()).toEqual([])
  })

  it('does not cache an answer it cannot read', async () => {
    const cache = new MemoryCache()
    const client = new OverpassClient({ cache, download: async () => ({ v: 99 }) as never })
    await expect(client.loadCells([A])).rejects.toMatchObject({ code: 'badResponse' })
    expect(await cache.keys()).toEqual([])
  })

  it('treats an expired or damaged cell as a miss and deletes the damaged one', async () => {
    const { calls, download } = fakeDownloader()
    const cache = new MemoryCache()
    const client = new OverpassClient({ cache, download })
    await client.loadCells([A])
    await client.settled()
    vi.advanceTimersByTime(CACHE_TTL_MS)
    expect(await client.cachedCell(A)).toBeUndefined()
    await client.loadCells([A])
    expect(calls).toHaveLength(2)
    await cache.set(cellCacheKey(B), { savedAt: Date.now(), data: { v: 4, broken: true } } as unknown as CacheEntry)
    expect(await client.cachedCell(B)).toBeUndefined()
    expect(await cache.get(cellCacheKey(B))).toBeUndefined()
    // An entry for another box under this key is damage too.
    await cache.set(cellCacheKey(B), (await cache.get(cellCacheKey(A)))!)
    expect(await client.cachedCell(B)).toBeUndefined()
  })

  it('rejects invalid cells before any cache or network access', async () => {
    const { calls, download } = fakeDownloader()
    const client = new OverpassClient({ cache: new MemoryCache(), download })
    await expect(client.loadCells([{ i: 0.5, j: 0 }])).rejects.toMatchObject({ code: 'badArea' })
    await expect(client.loadCells([])).rejects.toMatchObject({ code: 'badArea' })
    expect(calls).toHaveLength(0)
  })

  it('keeps at most MAX_CELL_ENTRIES cells, dropping the oldest saved', async () => {
    const cache = new MemoryCache()
    const old = Date.now() - 1000
    const index = Array.from({ length: MAX_CELL_ENTRIES }, (_, k) => ({ key: cellCacheKey({ i: 100, j: k }), savedAt: old + k }))
    for (const e of index) await cache.set(e.key, { savedAt: e.savedAt, data: {} as never })
    localStorage.setItem('stepquest.cellIndex', JSON.stringify(index))
    const { download } = fakeDownloader()
    const client = new OverpassClient({ cache, download })
    await client.loadCells([A])
    await client.settled()
    const kept = JSON.parse(localStorage.getItem('stepquest.cellIndex')!) as { key: string }[]
    expect(kept).toHaveLength(MAX_CELL_ENTRIES)
    expect(kept.at(-1)!.key).toBe(cellCacheKey(A))
    expect(await cache.get(cellCacheKey({ i: 100, j: 0 }))).toBeUndefined()
    expect(await cache.get(cellCacheKey({ i: 100, j: 1 }))).toBeDefined()
  })

  it('still returns the cells when the cache cannot write', async () => {
    const cache = new MemoryCache()
    cache.set = () => Promise.reject(new Error('quota'))
    const { download } = fakeDownloader()
    const client = new OverpassClient({ cache, download })
    const res = await client.loadCells([A])
    await client.settled()
    expect(res.records).toHaveLength(1)
    expect(localStorage.getItem('stepquest.cellIndex')).toBeNull()
  })
})
