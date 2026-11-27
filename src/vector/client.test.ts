import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../osm/cache.ts'
import { lodCacheKey, MAX_TILES_IN_FLIGHT, TILE_DEADLINE_MS, TILEJSON_TTL_MS, TILEJSON_URL, tileCacheKey, VectorTileClient } from './client.ts'
import { MAX_TILE_CONCURRENT } from '../world/streamer.ts'
import { encodeMvt } from './testing.ts'

const T = { z: 14, x: 8174, y: 6232 }
const TEMPLATE = 'https://tiles.example/planet/20261122_124456_pt/{z}/{x}/{y}.pbf'
const body = (): ArrayBuffer => (encodeMvt([{ name: 'transportation', features: [{ type: 2, props: { class: 'minor' }, geometry: [[[10, 10], [500, 10]]] }] }]).slice().buffer as ArrayBuffer)

function net(opts: { tile?: (url: string, init?: RequestInit) => Promise<Response>; tileJson?: () => Promise<Response> } = {}) {
  const calls: string[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url)
    if (url === TILEJSON_URL) return opts.tileJson ? opts.tileJson() : new Response(JSON.stringify({ tilejson: '3.0.0', tiles: [TEMPLATE], maxzoom: 14 }), { status: 200 })
    return opts.tile ? opts.tile(url, init) : new Response(body(), { status: 200 })
  })
  return { calls, fetch }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('vector tile client (requirements 21.2 and 21.8)', () => {
  it('reads the tile URL from the TileJSON at run time, then the tile, and converts it', async () => {
    const { calls, fetch } = net()
    const c = new VectorTileClient({ cache: new MemoryCache(), fetch })
    const data = await c.loadTile(T)
    expect(calls).toEqual([TILEJSON_URL, 'https://tiles.example/planet/20261122_124456_pt/14/8174/6232.pbf'])
    expect(data.ways.map((w) => w.highway)).toEqual(['residential'])
  })

  it('serves a tile from IndexedDB in a new session without any request, and keeps the TileJSON for a day', async () => {
    const cache = new MemoryCache()
    const first = net()
    const c1 = new VectorTileClient({ cache, fetch: first.fetch })
    await c1.loadTile(T)
    await c1.settled()
    expect(await cache.get(tileCacheKey(T))).toBeDefined()
    const second = net()
    const c2 = new VectorTileClient({ cache, fetch: second.fetch })
    expect((await c2.loadTile(T)).ways).toHaveLength(1)
    await c2.loadTile({ ...T, x: T.x + 1 })
    // The TileJSON came from storage; only the new tile was fetched.
    expect(second.calls).toEqual(['https://tiles.example/planet/20261122_124456_pt/14/8175/6232.pbf'])
  })

  it('uses a stale TileJSON when the fresh one cannot be read, and fails plainly without any', async () => {
    let now = 1_000_000
    const ok = new VectorTileClient({ cache: new MemoryCache(), fetch: net().fetch, now: () => now })
    await ok.loadTile(T)
    now += TILEJSON_TTL_MS + 1
    const down = net({ tileJson: async () => new Response('', { status: 503 }) })
    const c = new VectorTileClient({ cache: new MemoryCache(), fetch: down.fetch, now: () => now })
    await expect(c.loadTile({ ...T, y: T.y + 1 })).resolves.toBeDefined()
    localStorage.clear()
    const none = new VectorTileClient({ cache: new MemoryCache(), fetch: down.fetch })
    await expect(none.loadTile(T)).rejects.toMatchObject({ code: 'network' })
    const odd = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tileJson: async () => new Response('{"tiles":[]}') }).fetch })
    await expect(odd.loadTile(T)).rejects.toMatchObject({ code: 'badResponse' })
  })

  it('reads 404 and 204 as an empty tile, 429 as rateLimited, a server error as network; caches only good tiles', async () => {
    const cache = new MemoryCache()
    for (const [status, code] of [[429, 'rateLimited'], [500, 'network'], [400, 'badResponse']] as const) {
      const c = new VectorTileClient({ cache, fetch: net({ tile: async () => new Response('', { status }) }).fetch })
      await expect(c.loadTile(T)).rejects.toMatchObject({ code })
    }
    expect(await cache.get(tileCacheKey(T))).toBeUndefined()
    const empty = new VectorTileClient({ cache, fetch: net({ tile: async () => new Response(null, { status: 404 }) }).fetch })
    expect((await empty.loadTile(T)).ways).toEqual([])
  })

  it('runs at most MAX_TILES_IN_FLIGHT (4, OpenFreeMap’s limit) downloads and refuses the next one as busy', async () => {
    expect(MAX_TILES_IN_FLIGHT).toBe(4)
    expect(MAX_TILE_CONCURRENT).toBe(MAX_TILES_IN_FLIGHT)
    const releases: (() => void)[] = []
    const c = new VectorTileClient({
      cache: new MemoryCache(),
      fetch: net({ tile: () => new Promise((r) => releases.push(() => r(new Response(body(), { status: 200 })))) }).fetch,
    })
    await c.template()
    const running = Array.from({ length: MAX_TILES_IN_FLIGHT }, (_, k) => c.loadTile({ ...T, x: T.x + k }))
    await vi.waitFor(() => expect(releases).toHaveLength(MAX_TILES_IN_FLIGHT))
    expect(c.busy).toBe(true)
    await expect(c.loadTile({ ...T, x: T.x + 99 })).rejects.toMatchObject({ code: 'busy' })
    releases.forEach((r) => r())
    await Promise.all(running)
    expect(c.running).toBe(0)
  })

  it('frees the slot at the deadline when a tile never answers (even a fetch that ignores its abort signal)', async () => {
    vi.useFakeTimers()
    const c = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tile: () => new Promise<never>(() => undefined) }).fetch })
    const run = c.loadTile(T).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(TILE_DEADLINE_MS + 10)
    expect(await run).toMatchObject({ code: 'network' })
    expect(c.running).toBe(0)
  })

  it('treats a cache that never answers as a miss', async () => {
    vi.useFakeTimers()
    const stuck = { get: () => new Promise<never>(() => undefined), set: () => new Promise<never>(() => undefined) }
    const { calls, fetch } = net()
    const c = new VectorTileClient({ cache: stuck, fetch })
    const run = c.loadTile(T)
    await vi.advanceTimersByTimeAsync(3000)
    expect((await run).ways).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })
})

describe('LOD tiles from the same client (requirement 25.9)', () => {
  const lodBody = (): ArrayBuffer =>
    encodeMvt([
      { name: 'transportation', features: [{ type: 2, props: { class: 'minor' }, geometry: [[[10, 10], [500, 10]]] }] },
      { name: 'transportation_name', features: [{ type: 2, props: { class: 'minor', name: 'Calle Mayor' }, geometry: [[[10, 10], [500, 10]]] }] },
    ]).slice().buffer as ArrayBuffer

  it('downloads the raw tile once, converts it, keeps the street name, and counts the bytes received', async () => {
    const { calls, fetch } = net({ tile: async () => new Response(lodBody(), { status: 200 }) })
    const c = new VectorTileClient({ cache: new MemoryCache(), fetch })
    const t = await c.loadLod(T)
    expect(t.names.text).toEqual(['Calle Mayor'])
    expect(t.streets.kind.length).toBe(1)
    expect(calls).toEqual([TILEJSON_URL, 'https://tiles.example/planet/20261122_124456_pt/14/8174/6232.pbf'])
    expect(c.lodDownloads).toBe(1)
    expect(c.lodWireBytes).toBe(lodBody().byteLength)
  })

  it('saves it in IndexedDB under its own key and serves it to a new session with no request', async () => {
    const cache = new MemoryCache()
    const first = net({ tile: async () => new Response(lodBody(), { status: 200 }) })
    const c1 = new VectorTileClient({ cache, fetch: first.fetch })
    await c1.loadLod(T)
    await c1.settled()
    expect(await cache.get(lodCacheKey(T))).toBeDefined()
    expect(await cache.get(tileCacheKey(T))).toBeUndefined()
    const second = net()
    const c2 = new VectorTileClient({ cache, fetch: second.fetch })
    expect((await c2.cachedLod(T))?.names.text).toEqual(['Calle Mayor'])
    expect((await c2.loadLod(T)).names.text).toEqual(['Calle Mayor'])
    expect(second.calls).toEqual([])
    expect(c2.lodDownloads).toBe(0)
  })

  it('treats a damaged or expired entry as a miss and deletes the damaged one', async () => {
    const cache = new MemoryCache()
    await cache.set(lodCacheKey(T), { savedAt: Date.now(), data: { nonsense: true } as never })
    const c = new VectorTileClient({ cache, fetch: net({ tile: async () => new Response(lodBody(), { status: 200 }) }).fetch })
    expect(await c.cachedLod(T)).toBeUndefined()
    expect(await cache.get(lodCacheKey(T))).toBeUndefined()
    await cache.set(lodCacheKey(T), { savedAt: Date.now() - 8 * 24 * 3600 * 1000, data: (await c.loadLod(T)) as never })
    expect(await c.cachedLod(T)).toBeUndefined()
  })

  it('shares the four slots with the other tiles: a fifth download of either kind is refused as busy', async () => {
    const releases: (() => void)[] = []
    const c = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tile: () => new Promise((r) => releases.push(() => r(new Response(lodBody(), { status: 200 })))) }).fetch })
    await c.template()
    const running = [
      c.loadLod({ ...T, x: T.x }),
      c.loadTile({ ...T, x: T.x + 1 }),
      c.loadLod({ ...T, x: T.x + 2 }),
      c.loadTile({ ...T, x: T.x + 3 }),
    ]
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    expect(c.busy).toBe(true)
    await expect(c.loadLod({ ...T, x: T.x + 9 })).rejects.toMatchObject({ code: 'busy' })
    releases.forEach((r) => r())
    await Promise.all(running)
    expect(c.running).toBe(0)
  })

  it('reads 404 as an empty tile, 429 as rateLimited, and frees its slot at the deadline', async () => {
    const empty = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tile: async () => new Response(null, { status: 404 }) }).fetch })
    expect((await empty.loadLod(T)).streets.kind.length).toBe(0)
    const limited = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tile: async () => new Response('', { status: 429 }) }).fetch })
    await expect(limited.loadLod(T)).rejects.toMatchObject({ code: 'rateLimited' })
    vi.useFakeTimers()
    const stuck = new VectorTileClient({ cache: new MemoryCache(), fetch: net({ tile: () => new Promise<never>(() => undefined) }).fetch })
    const run = stuck.loadLod(T).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(TILE_DEADLINE_MS + 10)
    expect(await run).toMatchObject({ code: 'network' })
    expect(stuck.running).toBe(0)
  })
})
