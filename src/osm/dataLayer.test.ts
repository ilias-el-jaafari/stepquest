import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidBBox } from '../geo/geo.ts'
import { MemoryCache, isFresh, CACHE_TTL_MS, type AreaCache, type CacheEntry } from './cache.ts'
import { classifyWay, isBridge, isTunnel } from './classify.ts'
import { CODEC_VERSION, CorruptDataError, decodeOsm, encodeOsm, parseCompact, type CompactOsm } from './codec.ts'
import { overpassQuery } from './demoArea.ts'
import { fetchMirrors, isOverpassResponse } from './download.ts'
import { normalizeOverpass, type OverpassResponse } from './normalize.ts'
import { areaForWalk, bboxAreaKm2, cacheKey, MAX_AREA_KM2, MIN_REQUEST_GAP_MS, OverpassClient, snapBBox } from './overpass.ts'

const bbox = { south: 39.48, west: -0.4, north: 39.5, east: -0.38 }
const g = (lat: number, lon: number) => ({ lat, lon })
const road: OverpassResponse = {
  osm3s: { timestamp_osm_base: '2026-11-22T00:00:00Z' },
  elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, nodes: [1, 2], geometry: [g(39.49, -0.39), g(39.491, -0.39)] }],
}
const compactRoad = () => encodeOsm(normalizeOverpass(road, bbox))

beforeEach(() => localStorage.clear())

describe('multipolygons (66.4)', () => {
  // A 40 m square building with a 10 m courtyard, given as a relation like `out geom` prints it.
  const ring = (s: number, w: number, n: number, e: number) => [g(s, w), g(s, e), g(n, e), g(n, w), g(s, w)]
  const relation = (extra: Partial<NonNullable<OverpassResponse['elements']>[number]> = {}): OverpassResponse => ({
    elements: [
      {
        type: 'relation',
        id: 77,
        tags: { type: 'multipolygon', building: 'apartments' },
        members: [
          { type: 'way', ref: 1, role: 'outer', geometry: ring(39.4900, -0.3900, 39.4904, -0.3895) },
          { type: 'way', ref: 2, role: 'inner', geometry: ring(39.49015, -0.38985, 39.49025, -0.38975) },
        ],
        ...extra,
      } as never,
    ],
  })
  it('turns an outer ring with an inner ring into one area way with a hole', () => {
    const data = normalizeOverpass(relation(), bbox)
    expect(data.ways).toHaveLength(1)
    const way = data.ways[0]!
    expect(way.kind).toBe('building')
    expect(way.area).toBe(true)
    expect(way.holes).toHaveLength(1)
    expect(way.holes![0]![0]).toBe(way.holes![0]!.at(-1))
  })
  it('keeps the hole through the codec and the JSON text of the cache', () => {
    const data = normalizeOverpass(relation(), bbox)
    const back = decodeOsm(JSON.parse(JSON.stringify(encodeOsm(data))))
    expect(back.ways[0]!.holes).toEqual(data.ways[0]!.holes)
  })
  it('joins an outer ring split over two ways', () => {
    const full = ring(39.49, -0.39, 39.4904, -0.3895)
    const r = relation()
    r.elements![0]!.members = [
      { type: 'way', ref: 1, role: 'outer', geometry: full.slice(0, 3) },
      { type: 'way', ref: 3, role: 'outer', geometry: full.slice(2) },
    ]
    const data = normalizeOverpass(r, bbox)
    expect(data.ways).toHaveLength(1)
    expect(data.ways[0]!.holes).toBeUndefined()
  })
  it('ignores a ring that cannot close because part of it lies outside the data', () => {
    const r = relation()
    r.elements![0]!.members = [{ type: 'way', ref: 1, role: 'outer', geometry: ring(39.49, -0.39, 39.4904, -0.3895).slice(0, 3) }]
    expect(normalizeOverpass(r, bbox).ways).toHaveLength(0)
  })
  it('lets the relation win over an outer way that is tagged on its own (no second fill over the hole)', () => {
    const r = relation()
    r.elements!.push({ type: 'way', id: 1, tags: { building: 'yes' }, nodes: [1, 2, 3, 4, 1], geometry: ring(39.49, -0.39, 39.4904, -0.3895) } as never)
    const data = normalizeOverpass(r, bbox)
    expect(data.ways.filter((w) => w.kind === 'building')).toHaveLength(1)
  })
  it('keeps a separately tagged building inside the courtyard', () => {
    const r = relation()
    r.elements!.push({ type: 'way', id: 2, tags: { building: 'yes' }, nodes: [5, 6, 7, 8, 5], geometry: ring(39.49015, -0.38985, 39.49025, -0.38975) } as never)
    expect(normalizeOverpass(r, bbox).ways.filter((w) => w.kind === 'building')).toHaveLength(2)
  })
  it('does not turn a relation without type=multipolygon into an area', () => {
    const r = relation({ tags: { building: 'apartments' } })
    expect(normalizeOverpass(r, bbox).ways).toHaveLength(0)
  })
})

describe('malformed ways (66.4)', () => {
  it('splits a way at a point with NaN or out-of-range coordinates instead of drawing a chord', () => {
    const r: OverpassResponse = {
      elements: [
        {
          type: 'way',
          id: 5,
          tags: { highway: 'residential' },
          nodes: [1, 2, 3, 4, 5],
          geometry: [g(39.49, -0.39), g(39.4901, -0.39), g(Number.NaN, -0.39), g(39.4903, -0.39), g(39.4904, 1e9)],
        },
      ],
    }
    const data = normalizeOverpass(r, bbox)
    expect(data.ways.map((w) => w.nodes.length)).toEqual([2])
    for (const v of [...data.lat, ...data.lon]) expect(Number.isFinite(v)).toBe(true)
  })
  it('drops a "building" with fewer than three different corners', () => {
    const r: OverpassResponse = {
      elements: [
        { type: 'way', id: 6, tags: { building: 'yes' }, nodes: [1, 2, 1], geometry: [g(39.49, -0.39), g(39.4901, -0.39), g(39.49, -0.39)] },
        { type: 'way', id: 7, tags: { building: 'yes' }, nodes: [1, 1, 1, 1], geometry: [g(39.49, -0.39), g(39.49, -0.39), g(39.49, -0.39), g(39.49, -0.39)] },
      ],
    }
    expect(normalizeOverpass(r, bbox).ways).toHaveLength(0)
  })
  it('survives an elements array with null and non-object entries', () => {
    const r = { elements: [null, 5, 'x', ...road.elements!] } as unknown as OverpassResponse
    expect(normalizeOverpass(r, bbox).ways).toHaveLength(1)
    expect(normalizeOverpass({ elements: 'nope' } as unknown as OverpassResponse, bbox).ways).toHaveLength(0)
  })
  it('keeps zero-length segments (duplicate coordinates under different ids) without breaking', () => {
    const r: OverpassResponse = {
      elements: [{ type: 'way', id: 8, tags: { highway: 'residential' }, nodes: [1, 2, 3], geometry: [g(39.49, -0.39), g(39.49, -0.39), g(39.4901, -0.39)] }],
    }
    const data = normalizeOverpass(r, bbox)
    expect(data.ways).toHaveLength(1)
    expect(data.lat.length).toBe(3)
  })
})

describe('layer, bridge and tunnel tags (66.4)', () => {
  it('an explicit tunnel tag beats the layer', () => {
    expect(isTunnel({ tunnel: 'no', layer: '-1' })).toBe(false)
    expect(isTunnel({ tunnel: 'yes' })).toBe(true)
    expect(isTunnel({ layer: '-1' })).toBe(true)
    expect(isTunnel({ layer: '-1;0' })).toBe(false)
  })
  it('a bridge is never underground, whatever the layer says', () => {
    expect(isTunnel({ bridge: 'yes', layer: '-1' })).toBe(false)
    expect(isBridge({ bridge: 'viaduct' })).toBe(true)
    expect(isBridge({ bridge: 'no' })).toBe(false)
  })
  it('a track in a cutting (tunnel=no) is still classified as rail', () => {
    expect(classifyWay({ railway: 'tram', tunnel: 'no', layer: '-1' })).toBe('rail')
    expect(classifyWay({ railway: 'tram', tunnel: 'yes' })).toBeUndefined()
  })
  it('flags bridge roads and paths, and nothing else', () => {
    const r: OverpassResponse = {
      elements: [
        { type: 'way', id: 1, tags: { highway: 'footway', bridge: 'yes' }, nodes: [1, 2], geometry: [g(39.49, -0.39), g(39.4901, -0.39)] },
        { type: 'way', id: 2, tags: { highway: 'residential', bridge: 'no' }, nodes: [3, 4], geometry: [g(39.49, -0.38), g(39.4901, -0.38)] },
        { type: 'way', id: 3, tags: { waterway: 'canal', bridge: 'yes' }, nodes: [5, 6], geometry: [g(39.49, -0.37), g(39.4901, -0.37)] },
      ],
    }
    expect(normalizeOverpass(r, bbox).ways.map((w) => !!w.bridge)).toEqual([true, false, false])
  })
})

describe('codec versions and corruption (66.5)', () => {
  it('writes the current version and decodes older ones', () => {
    expect(compactRoad().v).toBe(CODEC_VERSION)
    const v3 = { ...compactRoad(), v: 3 as const }
    expect(decodeOsm(v3).ways).toHaveLength(1)
  })
  it('rejects data that is not a map extract', () => {
    const bad = (mutate: (c: CompactOsm) => void) => {
      const c = JSON.parse(JSON.stringify(compactRoad())) as CompactOsm
      mutate(c)
      expect(() => decodeOsm(c)).toThrow(CorruptDataError)
    }
    bad((c) => (c.v = 9 as never))
    bad((c) => (c.ways[0]![0] = 99)) // unknown kind used to become a road
    bad((c) => (c.ways[0]!.push(500))) // node index out of range
    bad((c) => c.dlon.pop())
    bad((c) => (c.bbox = [0, 0, 0] as never))
    bad((c) => (c.ids = []))
    expect(() => decodeOsm(null as never)).toThrow(CorruptDataError)
    expect(() => decodeOsm('x' as never)).toThrow(CorruptDataError)
  })
})

describe('Overpass answers (66.7)', () => {
  it('accepts only an object with an elements array', () => {
    expect(isOverpassResponse({ elements: [] })).toBe(true)
    for (const bad of [null, 5, 'x', [], {}, { remark: 'x' }, { elements: {} }]) expect(isOverpassResponse(bad)).toBe(false)
  })
  const once = (body: string, status = 200) => fetchMirrors({ query: overpassQuery(bbox), endpoints: ['https://one'], fetch: async () => new Response(body, { status }) })
  it('reports an answer without elements as badResponse instead of an empty map', async () => {
    await expect(once('{"version":0.6}')).rejects.toMatchObject({ code: 'badResponse' })
    await expect(once('null')).rejects.toMatchObject({ code: 'badResponse' })
    await expect(once('<html>busy</html>')).rejects.toMatchObject({ code: 'badResponse' })
  })
  it('reports a timed-out query (200 with a remark) as busy even when it has no elements', async () => {
    await expect(once('{"remark":"runtime error: Query timed out in \\"query\\" at line 3"}')).rejects.toMatchObject({ code: 'busy' })
    await expect(once('{"elements":[],"remark":"runtime error: Query ran out of memory"}')).rejects.toMatchObject({ code: 'busy' })
  })
  it('maps 429 and 504 to rateLimited and other failures to badResponse, with one request per mirror', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429 }))
    await expect(fetchMirrors({ query: overpassQuery(bbox), endpoints: ['https://a', 'https://b'], fetch })).rejects.toMatchObject({ code: 'rateLimited' })
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(once('', 504)).rejects.toMatchObject({ code: 'rateLimited' })
    await expect(once('', 400)).rejects.toMatchObject({ code: 'badResponse' })
  })
  it('refuses to build a query for a box Overpass would reject', () => {
    expect(() => overpassQuery({ ...bbox, north: Number.NaN })).toThrow(RangeError)
    expect(() => overpassQuery({ ...bbox, east: 181 })).toThrow(RangeError)
    expect(overpassQuery(bbox, 30)).toContain('39.48000,-0.40000,39.50000,-0.38000')
  })
})

describe('area cache and client (66.6)', () => {
  const client = (cache: AreaCache, over: Partial<ConstructorParameters<typeof OverpassClient>[0]> = {}) => {
    const download = vi.fn(async () => compactRoad())
    return { download, client: new OverpassClient({ cache, download, ...over }) }
  }

  it('treats a damaged cache entry as a miss, deletes it and downloads', async () => {
    const cache = new MemoryCache()
    await cache.set(cacheKey(bbox), { savedAt: Date.now(), data: { v: 3, junk: true } as never })
    const { client: c, download } = client(cache)
    const out = await c.loadArea(bbox)
    expect(out.fromCache).toBe(false)
    expect(download).toHaveBeenCalledTimes(1)
    expect(out.data.ways).toHaveLength(1)
    // The download replaced the damaged entry with a good one.
    expect(parseCompact((await cache.get(cacheKey(bbox)))!.data).v).toBe(CODEC_VERSION)
  })

  it('ignores foreign or damaged entries of the area index', async () => {
    localStorage.setItem('stepquest.areaIndex', JSON.stringify([null, 5, { key: 1 }, { key: 'k', bbox: 'x', savedAt: 1 }]))
    const { client: c } = client(new MemoryCache())
    expect((await c.loadArea(bbox)).fromCache).toBe(false)
    localStorage.setItem('stepquest.areaIndex', '{not json')
    const { client: c2 } = client(new MemoryCache())
    expect((await c2.loadArea(bbox)).fromCache).toBe(false)
  })

  it('does not trust an entry saved in the future, and expires old ones', () => {
    const now = 1_000_000_000_000
    expect(isFresh(now - 1000, now)).toBe(true)
    expect(isFresh(now - CACHE_TTL_MS - 1, now)).toBe(false)
    expect(isFresh(now + 3_600_000, now)).toBe(false)
    expect(isFresh(Number.NaN, now)).toBe(false)
    expect(isFresh('1' as never, now)).toBe(false)
  })

  it('includes the codec version in the key so a format change retires old entries', () => {
    expect(cacheKey(bbox).startsWith(`v${CODEC_VERSION}:`)).toBe(true)
  })

  it('downloads the box grown to the cache grid, so an entry covers every request with its key', async () => {
    const odd = { south: 39.48049, west: -0.39951, north: 39.49951, east: -0.38049 }
    const snapped = snapBBox(odd)
    expect(snapped.south).toBeLessThanOrEqual(odd.south)
    expect(snapped.north).toBeGreaterThanOrEqual(odd.north)
    expect(snapped.west).toBeLessThanOrEqual(odd.west)
    expect(snapped.east).toBeGreaterThanOrEqual(odd.east)
    expect(cacheKey(odd)).toBe(cacheKey(snapped))
    const seen: unknown[] = []
    const { client: c } = client(new MemoryCache(), { download: async (b) => (seen.push(b), compactRoad()) })
    await c.loadArea(odd)
    expect(seen[0]).toEqual(snapped)
    // Lines already on the grid stay put (no float drift from 39.48 * 1000).
    expect(snapBBox(bbox)).toEqual(bbox)
  })

  it('refuses invalid boxes before any cache or network access', async () => {
    const { client: c, download } = client(new MemoryCache())
    for (const bad of [{ ...bbox, north: Number.NaN }, { ...bbox, north: bbox.south - 1 }, { ...bbox, east: 200 }]) {
      await expect(c.loadArea(bad)).rejects.toMatchObject({ code: 'badArea' })
    }
    expect(download).not.toHaveBeenCalled()
  })

  it('applies the 36 km² cap to the box that is really downloaded, and the walk box fits under it', async () => {
    const edge = { south: 39.4, west: -0.4, north: 39.4 + 6.1 / 111.32, east: -0.4 + 6.1 / (111.32 * Math.cos(39.4 * (Math.PI / 180))) }
    expect(bboxAreaKm2(edge)).toBeGreaterThan(MAX_AREA_KM2)
    const { client: c, download } = client(new MemoryCache())
    await expect(c.loadArea(edge)).rejects.toMatchObject({ code: 'tooLarge' })
    expect(download).not.toHaveBeenCalled()
    for (const lat of [0, 39.5, 60]) {
      const widest = areaForWalk({ lat, lon: 10 }, 60_000)
      expect(isValidBBox(widest)).toBe(true)
      expect(bboxAreaKm2(snapBBox(widest))).toBeLessThanOrEqual(MAX_AREA_KM2)
    }
  })

  it('still serves the data when the cache cannot write (quota), and records nothing in the index', async () => {
    class Full extends MemoryCache {
      override async set(): Promise<void> {
        throw new DOMException('full', 'QuotaExceededError')
      }
    }
    const { client: c } = client(new Full())
    const out = await c.loadArea(bbox)
    expect(out.data.ways).toHaveLength(1)
    expect(localStorage.getItem('stepquest.areaIndex')).toBeNull()
  })

  it('does not cache an answer it cannot decode, and reports it as badResponse', async () => {
    const cache = new MemoryCache()
    const { client: c } = client(cache, { download: async () => ({ ...compactRoad(), ways: [[99, -1, 0, -1, 0, 1]] }) })
    await expect(c.loadArea(bbox)).rejects.toMatchObject({ code: 'badResponse' })
    expect(await cache.keys()).toEqual([])
  })

  it('removes expired and evicted areas and entries of older cache versions (local storage only)', async () => {
    let now = 1_000_000_000_000
    const cache = new MemoryCache()
    const entry = (): CacheEntry => ({ savedAt: now, data: compactRoad() })
    await cache.set('v3:old', entry())
    const { client: c, download } = client(cache, { now: () => now })
    await c.loadArea(bbox)
    expect(await cache.get('v3:old')).toBeUndefined()
    // A week later the first area is expired: loading another drops it from the cache.
    const first = cacheKey(bbox)
    now += CACHE_TTL_MS + 20_000
    const other = { south: 40, west: 1, north: 40.01, east: 1.01 }
    await c.loadArea(other)
    expect(await cache.get(first)).toBeUndefined()
    expect(await cache.get(cacheKey(other))).toBeDefined()
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('sends no extra request: one download per load, spacing and busy rules unchanged', async () => {
    let now = 5_000_000
    let release: (() => void) | undefined
    const download = vi.fn(
      () =>
        new Promise<CompactOsm>((resolve) => {
          release = () => resolve(compactRoad())
        }),
    )
    const c = new OverpassClient({ cache: new MemoryCache(), download, now: () => now })
    const first = c.loadArea(bbox)
    await expect(c.loadArea({ ...bbox, south: 10, north: 10.01 })).rejects.toMatchObject({ code: 'busy' })
    release?.()
    await first
    await expect(c.loadArea({ south: 20, west: 20, north: 20.01, east: 20.01 })).rejects.toMatchObject({ code: 'rateLimited' })
    now += MIN_REQUEST_GAP_MS
    expect(download).toHaveBeenCalledTimes(1)
  })
})
