import { describe, expect, it } from 'vitest'
import { haversine, type BBox } from '../geo/geo.ts'
import { decodeOsm } from '../osm/codec.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planLoop, planOneWay } from '../routing/planner.ts'
import fixture from './__fixtures__/valencia-z14.json'
import { buildWalkNet, NODE_TOL_M, type WalkNetStats } from './walkNet.ts'

const BOX: BBox = { south: 39.4, west: -0.4, north: 39.5, east: -0.3 }
const M = 1 / 111_195

/** A tile-like extract from lines given as [lat, lon] lists. */
function lines(specs: { pts: [number, number][]; highway?: string; bridge?: boolean; tunnel?: boolean }[]): OsmData {
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = specs.map((s, k) => ({
    id: k + 1,
    kind: 'road',
    highway: s.highway ?? 'residential',
    walkable: true,
    area: false,
    tunnel: !!s.tunnel,
    ...(s.bridge ? { bridge: true } : {}),
    crossing: false,
    nodes: s.pts.map(([la, lo]) => (lat.push(la), lon.push(lo), lat.length - 1)),
  }))
  return { bbox: BOX, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [], source: 'tiles', timestamp: '' }
}

const at = (north: number, east: number): [number, number] => [39.45 + north * M, -0.35 + (east * M) / Math.cos((39.45 * Math.PI) / 180)]
const components = (d: OsmData) => new Set(Array.from(new WalkGraph(d).component)).size

describe('buildWalkNet', () => {
  it('makes equal points one node, so the two halves of a street cut at a tile edge meet', () => {
    const a = lines([{ pts: [at(0, -200), at(0, 0)] }])
    const b = lines([{ pts: [at(0, 0.00001), at(0, 200)] }])
    const stats: WalkNetStats = { ways: 0, joined: 0, connected: 0, split: 0 }
    const net = buildWalkNet([a, b], BOX, stats)
    expect(net.ways).toHaveLength(1)
    expect(net.ways[0]!.nodes).toHaveLength(3)
    expect(stats.joined).toBe(1)
  })

  it('does not join pieces of different kinds of way', () => {
    const a = lines([{ pts: [at(0, -200), at(0, 0)], highway: 'residential' }])
    const b = lines([{ pts: [at(0, 0), at(0, 200)], highway: 'secondary' }])
    expect(buildWalkNet([a, b], BOX).ways).toHaveLength(2)
    expect(components(buildWalkNet([a, b], BOX))).toBe(1)
  })

  it('splits a street where a dead end meets it without a shared vertex (a T-junction the tile simplified)', () => {
    const d = lines([{ pts: [at(0, -300), at(0, 300)] }, { pts: [at(200, 0), at(NODE_TOL_M - 1, 0)] }])
    expect(components(buildWalkNet([d], BOX))).toBe(1)
    const stats: WalkNetStats = { ways: 0, joined: 0, connected: 0, split: 0 }
    const net = buildWalkNet([d], BOX, stats)
    expect(stats.split).toBe(1)
    // The long street has the new vertex between its two ends.
    expect(net.ways[0]!.nodes).toHaveLength(3)
    const mid = net.ways[0]!.nodes[1]!
    expect(haversine({ lat: net.lat[mid]!, lon: net.lon[mid]! }, { lat: 39.45, lon: -0.35 })).toBeLessThan(1.5)
  })

  it('uses the nearest existing vertex when the meeting point is within half a metre of it', () => {
    const d = lines([{ pts: [at(0, -300), at(0, 0), at(0, 300)] }, { pts: [at(200, 0.2), at(1, 0.2)] }])
    const stats: WalkNetStats = { ways: 0, joined: 0, connected: 0, split: 0 }
    const net = buildWalkNet([d], BOX, stats)
    expect(stats.split).toBe(0)
    expect(net.ways[0]!.nodes).toHaveLength(3)
    expect(components(net)).toBe(1)
  })

  it('leaves a street that ends farther away than the tolerance alone', () => {
    const d = lines([{ pts: [at(0, -300), at(0, 300)] }, { pts: [at(200, 0), at(NODE_TOL_M + 3, 0)] }])
    expect(components(buildWalkNet([d], BOX))).toBe(2)
  })

  it('never connects a dead end to a bridge or a tunnel passing by', () => {
    for (const kind of [{ bridge: true }, { tunnel: true }]) {
      const d = lines([{ pts: [at(0, -300), at(0, 300)], ...kind }, { pts: [at(200, 0), at(1, 0)] }])
      expect(components(buildWalkNet([d], BOX))).toBe(2)
    }
  })

  it('cuts several dead ends into the same segment in order', () => {
    const d = lines([
      { pts: [at(0, -300), at(0, 300)] },
      { pts: [at(100, -100), at(1, -100)] },
      { pts: [at(100, 100), at(-1, 100)] },
      { pts: [at(-100, 0), at(-1, 0)] },
    ])
    const net = buildWalkNet([d], BOX)
    expect(components(net)).toBe(1)
    const lons = net.ways[0]!.nodes.map((n) => net.lon[n]!)
    expect(lons).toEqual([...lons].sort((x, y) => x - y))
    expect(lons).toHaveLength(5)
  })

  it('ignores areas, buildings and ways a pedestrian may not use', () => {
    const d = lines([{ pts: [at(0, -100), at(0, 100)] }])
    d.ways.push({ ...d.ways[0]!, id: 9, walkable: false })
    d.ways.push({ ...d.ways[0]!, id: 10, area: true })
    d.ways.push({ ...d.ways[0]!, id: 11, kind: 'building' })
    expect(buildWalkNet([d], BOX).ways).toHaveLength(1)
  })
})

type Fixture = { corner: { lat: number; lon: number }; tiles: { id: { z: number; x: number; y: number }; data: Parameters<typeof decodeOsm>[0] }[] }
const real = fixture as unknown as Fixture
const tiles = real.tiles.map((t) => decodeOsm(t.data))
const walkBox: BBox = { south: real.corner.lat - 0.009, west: real.corner.lon - 0.011, north: real.corner.lat + 0.009, east: real.corner.lon + 0.011 }

describe('buildWalkNet on real València tiles (a seam of four z14 tiles)', () => {
  const stats: WalkNetStats = { ways: 0, joined: 0, connected: 0, split: 0 }
  const net = buildWalkNet(tiles, walkBox, stats)
  const graph = new WalkGraph(net)

  it('keeps at least 95 % of the street length in one connected network', () => {
    let total = 0
    let main = 0
    for (let n = 0; n < graph.size; n++) {
      for (let i = graph.offsets[n]!; i < graph.offsets[n + 1]!; i++) {
        if (graph.targets[i]! < n) continue
        total += graph.lengths[i]!
        if (graph.component[n] === 0) main += graph.lengths[i]!
      }
    }
    expect(total).toBeGreaterThan(30_000)
    expect(main / total).toBeGreaterThanOrEqual(0.95)
  })

  it('without snapping and noding the same tiles fall apart (why the step exists)', () => {
    const raw: OsmData = { ...net, ways: [] }
    const lat: number[] = []
    const lon: number[] = []
    const ways: OsmWay[] = []
    const key = new Map<string, number>()
    for (const t of tiles) {
      for (const w of t.ways) {
        const nodes = w.nodes.map((n) => {
          const k = `${t.lat[n]},${t.lon[n]}`
          let at = key.get(k)
          if (at === undefined) {
            at = lat.length
            key.set(k, at)
            lat.push(t.lat[n]!)
            lon.push(t.lon[n]!)
          }
          return at
        })
        ways.push({ ...w, nodes })
      }
    }
    const naive = new WalkGraph({ ...raw, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways })
    const share = (g: WalkGraph) => g.component.filter((c) => c === 0).length / g.size
    expect(share(naive)).toBeLessThan(share(graph) - 0.2)
  })

  it('has streets across the seam: a route from the north-west tile to the south-east tile exists', () => {
    const a = graph.nearestNode({ lat: real.corner.lat + 0.004, lon: real.corner.lon - 0.004 })!
    const b = graph.nearestNode({ lat: real.corner.lat - 0.004, lon: real.corner.lon + 0.004 })!
    expect(a.distance).toBeLessThan(60)
    expect(b.distance).toBeLessThan(60)
    const path = graph.shortestPath(a.node, b.node)
    expect(path).toBeDefined()
    const straight = haversine(graph.point(a.node), graph.point(b.node))
    expect(path!.length).toBeLessThan(straight * 1.8)
  })

  it('plans a loop of 3,000 steps within ±5 % from the seam', () => {
    const r = planLoop(graph, { mode: 'loop', start: real.corner, targetSteps: 3000, strideM: 0.75 }, net.bbox)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Math.abs(r.route.error)).toBeLessThanOrEqual(0.05)
  })

  it('plans an A → B walk across the seam within ±5 %', () => {
    const r = planOneWay(
      graph,
      { mode: 'oneway', start: { lat: real.corner.lat + 0.004, lon: real.corner.lon - 0.004 }, end: { lat: real.corner.lat - 0.004, lon: real.corner.lon + 0.004 }, targetSteps: 2500, strideM: 0.75 },
      net.bbox,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(Math.abs(r.route.error)).toBeLessThanOrEqual(0.05)
  })

  it('is built in well under a second', () => {
    const t = performance.now()
    buildWalkNet(tiles, walkBox)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})
