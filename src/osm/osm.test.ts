import { describe, expect, it, vi } from 'vitest'
import { bboxAround, bboxContains } from '../geo/geo.ts'
import { MemoryCache } from './cache.ts'
import { classifyWay, isArea, isCrossing, isIndustrialLand, isLively, isTunnel, isWalkable, safetyFlags } from './classify.ts'
import { SAFETY_ALLEY, SAFETY_COVERED, SAFETY_LIT, SAFETY_SIDEWALK, SAFETY_UNLIT } from './types.ts'
import { decodeOsm, encodeOsm } from './codec.ts'
import { DEMO_AREA, overpassQuery } from './demoArea.ts'
import { loadDemoOsm } from './demo.ts'
import { normalizeOverpass, type OverpassResponse } from './normalize.ts'
import { areaForWalk, bboxAreaKm2, cacheKey, OverpassClient, OverpassError } from './overpass.ts'

const sample: OverpassResponse = {
  osm3s: { timestamp_osm_base: '2026-11-20T19:11:51Z' },
  elements: [
    { type: 'way', id: 1, tags: { highway: 'residential' }, nodes: [10, 11, 12],
      geometry: [{ lat: 39.49, lon: -0.39 }, { lat: 39.491, lon: -0.39 }, { lat: 39.492, lon: -0.39 }] },
    { type: 'way', id: 2, tags: { highway: 'footway' }, nodes: [12, 13],
      geometry: [{ lat: 39.492, lon: -0.39 }, { lat: 39.492, lon: -0.389 }] },
    { type: 'way', id: 3, tags: { building: 'yes' }, nodes: [20, 21, 22, 20],
      geometry: [{ lat: 39.4901, lon: -0.3895 }, { lat: 39.4901, lon: -0.3890 }, { lat: 39.4905, lon: -0.3890 }, { lat: 39.4901, lon: -0.3895 }] },
    { type: 'way', id: 4, tags: { highway: 'construction' }, nodes: [30, 31],
      geometry: [{ lat: 39.49, lon: -0.38 }, { lat: 39.491, lon: -0.38 }] },
    { type: 'node' } as never,
  ] as OverpassResponse['elements'],
}
const bbox = { south: 39.48, west: -0.4, north: 39.5, east: -0.38 }

describe('classifyWay', () => {
  it('sorts OSM tags into our layers', () => {
    expect(classifyWay({ highway: 'primary' })).toBe('road')
    expect(classifyWay({ highway: 'footway' })).toBe('path')
    expect(classifyWay({ highway: 'steps' })).toBe('path')
    expect(classifyWay({ building: 'apartments' })).toBe('building')
    expect(classifyWay({ building: 'no' })).toBeUndefined()
    expect(classifyWay({ leisure: 'park' })).toBe('park')
    expect(classifyWay({ landuse: 'grass' })).toBe('park')
    expect(classifyWay({ natural: 'water' })).toBe('water')
    expect(classifyWay({ waterway: 'canal' })).toBe('waterway')
    expect(classifyWay({ highway: 'construction' })).toBeUndefined()
    expect(classifyWay({ amenity: 'bench' })).toBeUndefined()
  })
  it('decides walkability like a pedestrian would', () => {
    expect(isWalkable({ highway: 'residential' })).toBe(true)
    expect(isWalkable({ highway: 'footway' })).toBe(true)
    expect(isWalkable({ highway: 'motorway' })).toBe(false)
    expect(isWalkable({ highway: 'trunk' })).toBe(false)
    expect(isWalkable({ highway: 'trunk', foot: 'yes' })).toBe(true)
    expect(isWalkable({ highway: 'cycleway' })).toBe(false)
    expect(isWalkable({ highway: 'cycleway', foot: 'designated' })).toBe(true)
    expect(isWalkable({ highway: 'service', access: 'private' })).toBe(false)
    expect(isWalkable({ highway: 'primary', foot: 'no' })).toBe(false)
    expect(isWalkable({ building: 'yes' })).toBe(false)
  })
  it('detects areas and tunnels', () => {
    expect(isArea('building', {}, true)).toBe(true)
    expect(isArea('building', {}, false)).toBe(false)
    expect(isArea('path', { highway: 'pedestrian' }, true)).toBe(false)
    expect(isArea('path', { highway: 'pedestrian', area: 'yes' }, true)).toBe(true)
    expect(isCrossing({ highway: 'footway', footway: 'crossing' })).toBe(true)
    expect(isCrossing({ highway: 'footway', footway: 'sidewalk' })).toBe(false)
    expect(isTunnel({ tunnel: 'yes' })).toBe(true)
    expect(isTunnel({ layer: '-1' })).toBe(true)
    expect(isTunnel({ bridge: 'yes', layer: '1' })).toBe(false)
  })
})

describe('normalizeOverpass', () => {
  const data = normalizeOverpass(sample, bbox)
  it('keeps supported ways and drops the rest', () => {
    expect(data.ways.map((w) => w.id)).toEqual([1, 2, 3])
    expect(data.timestamp).toBe('2026-11-20T19:11:51Z')
  })
  it('shares node indices where ways meet', () => {
    const road = data.ways[0]!
    const foot = data.ways[1]!
    expect(road.nodes[2]).toBe(foot.nodes[0])
    // Nodes 10, 11, 12, 13 and 20, 21, 22 (the closing node is reused).
    expect(data.lat.length).toBe(7)
  })
  it('marks closed buildings as areas', () => {
    expect(data.ways[2]).toMatchObject({ kind: 'building', area: true, walkable: false })
  })
})

describe('compact codec', () => {
  it('round-trips data to within 0.2 m', () => {
    const data = normalizeOverpass(sample, bbox)
    const back = decodeOsm(JSON.parse(JSON.stringify(encodeOsm(data))))
    expect(back.ways).toEqual(data.ways)
    for (let i = 0; i < data.lat.length; i++) {
      expect(Math.abs(back.lat[i]! - data.lat[i]!)).toBeLessThan(2e-6)
      expect(Math.abs(back.lon[i]! - data.lon[i]!)).toBeLessThan(2e-6)
    }
    expect(back.bbox).toEqual(bbox)
  })
  it('rejects unknown versions', () => {
    expect(() => decodeOsm({ ...encodeOsm(normalizeOverpass(sample, bbox)), v: 9 as 1 })).toThrow()
  })
})

describe('bundled Benicalap fixture', () => {
  const data = loadDemoOsm()
  it('loads offline with thousands of ways of every kind', () => {
    expect(data.source).toBe('fixture')
    expect(data.ways.length).toBeGreaterThan(10_000)
    for (const kind of ['road', 'path', 'building', 'park', 'water', 'waterway'] as const) {
      expect(data.ways.some((w) => w.kind === kind), kind).toBe(true)
    }
  })
  it('covers the demo start point', () => {
    expect(bboxContains(data.bbox, DEMO_AREA.defaultStart)).toBe(true)
    expect(bboxContains(data.bbox, DEMO_AREA.defaultEnd)).toBe(true)
  })
})

describe('Overpass client', () => {
  const okResponse = () => new Response(JSON.stringify(sample), { status: 200 })

  it('builds a query for every layer', () => {
    const q = overpassQuery(bbox)
    for (const part of ['way["highway"]', 'way["building"]', 'leisure', 'landuse', 'natural', 'waterway', 'out geom']) {
      expect(q).toContain(part)
    }
  })
  it('caches results and serves the second request without the network', async () => {
    const fetch = vi.fn(async () => okResponse())
    let clock = 1_000_000
    const client = new OverpassClient({ cache: new MemoryCache(), fetch, now: () => clock, endpoints: ['https://only'] })
    const first = await client.loadArea(bbox)
    expect(first.fromCache).toBe(false)
    expect(first.data.ways).toHaveLength(3)
    clock += 1000
    const second = await client.loadArea(bbox)
    expect(second.fromCache).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.method).toBe('POST')
    expect(String(init.body)).toMatch(/^data=/)
  })
  it('refetches after the cache expires but never faster than the minimum gap', async () => {
    const fetch = vi.fn(async () => okResponse())
    let clock = 0
    const client = new OverpassClient({ cache: new MemoryCache(), fetch, now: () => clock, endpoints: ['https://only'] })
    await client.loadArea(bbox)
    const other = { ...bbox, north: bbox.north + 0.01 }
    clock += 2000
    await expect(client.loadArea(other)).rejects.toMatchObject({ code: 'rateLimited' })
    clock += 10_000
    await expect(client.loadArea(other)).resolves.toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('falls back to the second endpoint when the first is busy', async () => {
    const fetch = vi.fn(async (url: string) => (url.includes('first') ? new Response('', { status: 429 }) : okResponse()))
    const client = new OverpassClient({ cache: new MemoryCache(), fetch, endpoints: ['https://first', 'https://second'] })
    const result = await client.loadArea(bbox)
    expect(result.data.ways).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('refuses huge areas without calling the network', async () => {
    const fetch = vi.fn(async () => okResponse())
    const client = new OverpassClient({ cache: new MemoryCache(), fetch })
    const huge = bboxAround(DEMO_AREA.center, 10_000)
    expect(bboxAreaKm2(huge)).toBeGreaterThan(300)
    await expect(client.loadArea(huge)).rejects.toBeInstanceOf(OverpassError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reports network failures', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline')
    })
    const client = new OverpassClient({ cache: new MemoryCache(), fetch, endpoints: ['https://only'] })
    await expect(client.loadArea(bbox)).rejects.toMatchObject({ code: 'network' })
  })
  it('rounds cache keys so nearby boxes share an entry', () => {
    expect(cacheKey(bbox)).toBe(cacheKey({ ...bbox, south: bbox.south + 0.0001 }))
  })
  it('sizes the download for a loop or an A→B walk', () => {
    const loop = areaForWalk(DEMO_AREA.center, 7500)
    expect(bboxAreaKm2(loop)).toBeGreaterThan(4)
    expect(bboxAreaKm2(loop)).toBeLessThan(36)
    const oneway = areaForWalk(DEMO_AREA.defaultStart, 3000, DEMO_AREA.defaultEnd)
    expect(bboxContains(oneway, DEMO_AREA.defaultStart)).toBe(true)
    expect(bboxContains(oneway, DEMO_AREA.defaultEnd)).toBe(true)
  })
})

describe('safety tags', () => {
  it('reads lighting, sidewalks, alleys and covered ways', () => {
    expect(safetyFlags({ highway: 'residential', lit: 'yes', sidewalk: 'both' })).toBe(SAFETY_LIT | SAFETY_SIDEWALK)
    expect(safetyFlags({ highway: 'footway', lit: 'no' })).toBe(SAFETY_UNLIT)
    expect(safetyFlags({ highway: 'footway', footway: 'sidewalk' })).toBe(SAFETY_SIDEWALK)
    expect(safetyFlags({ highway: 'residential', sidewalk: 'no' })).toBe(0)
    expect(safetyFlags({ highway: 'service', service: 'alley' })).toBe(SAFETY_ALLEY)
    expect(safetyFlags({ highway: 'service', service: 'driveway' })).toBe(SAFETY_ALLEY)
    expect(safetyFlags({ highway: 'footway', tunnel: 'yes' }) & SAFETY_COVERED).toBeTruthy()
    expect(safetyFlags({ highway: 'footway', covered: 'yes' }) & SAFETY_COVERED).toBeTruthy()
  })
  it('spots lively places and industrial land', () => {
    expect(isLively({ shop: 'bakery' })).toBe(true)
    expect(isLively({ shop: 'vacant' })).toBe(false)
    expect(isLively({ amenity: 'cafe' })).toBe(true)
    expect(isLively({ amenity: 'parking' })).toBe(false)
    expect(isIndustrialLand({ landuse: 'industrial' })).toBe(true)
    expect(isIndustrialLand({ landuse: 'residential' })).toBe(false)
  })
  it('keeps names, safety, industrial land and activity through normalize and the v3 codec', () => {
    const json: OverpassResponse = {
      osm3s: { timestamp_osm_base: '2026-11-20T19:11:51Z' },
      elements: [
        { type: 'way', id: 1, tags: { highway: 'residential', name: 'Calle Mayor', lit: 'yes', sidewalk: 'both' }, nodes: [1, 2],
          geometry: [{ lat: 39.49, lon: -0.39 }, { lat: 39.491, lon: -0.39 }] },
        { type: 'way', id: 2, tags: { landuse: 'industrial' }, nodes: [5, 6, 7, 5],
          geometry: [{ lat: 39.485, lon: -0.395 }, { lat: 39.485, lon: -0.394 }, { lat: 39.486, lon: -0.394 }, { lat: 39.485, lon: -0.395 }] },
        { type: 'node', id: 9, lat: 39.4905, lon: -0.3901, tags: { shop: 'bakery' } },
      ] as OverpassResponse['elements'],
    }
    const data = normalizeOverpass(json, bbox)
    const street = data.ways.find((w) => w.id === 1)!
    expect(street.name).toBe('Calle Mayor')
    expect(street.safety).toBe(SAFETY_LIT | SAFETY_SIDEWALK)
    expect(data.industrial).toHaveLength(1)
    expect(data.activity).toEqual([39.4905, -0.3901])
    const back = decodeOsm(JSON.parse(JSON.stringify(encodeOsm(data))))
    expect(back.ways.find((w) => w.id === 1)).toMatchObject({ name: 'Calle Mayor', safety: SAFETY_LIT | SAFETY_SIDEWALK })
    expect(back.industrial).toEqual(data.industrial)
    expect(back.activity).toEqual(data.activity)
  })
  it('asks Overpass for the safety data', () => {
    const q = overpassQuery(DEMO_AREA.bbox)
    expect(q).toContain('landuse')
    expect(q).toContain('"shop"')
    expect(q).toContain('amenity')
  })
  it('ships the demo area with names, lighting and lively places', () => {
    const demo = loadDemoOsm()
    const walk = demo.ways.filter((w) => w.walkable)
    expect(walk.filter((w) => w.name).length).toBeGreaterThan(500)
    expect(walk.filter((w) => (w.safety ?? 0) & SAFETY_LIT).length).toBeGreaterThan(300)
    expect((demo.activity ?? []).length / 2).toBeGreaterThan(300)
    expect((demo.industrial ?? []).length).toBeGreaterThan(10)
  })
})
