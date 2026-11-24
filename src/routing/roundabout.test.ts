import { describe, expect, it } from 'vitest'
import { LocalProjection } from '../geo/geo.ts'
import { decodeOsm, encodeOsm } from '../osm/codec.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { normalizeOverpass, type OverpassResponse } from '../osm/normalize.ts'
import { crossesIsland, findRoundabouts, insidePolygon } from '../osm/roundabout.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { WalkGraph } from './graph.ts'

const bbox = { south: 39.49, west: -0.4, north: 39.4958, east: -0.392 }
const centre = { lat: 39.4929, lon: -0.396 }
const proj = new LocalProjection(centre)

/** A 16-node ring of radius 15 m, a spoke footway on each side and an optional path through the island. */
function plaza(opts: { tagged: boolean; through: boolean; radius?: number }): OsmData {
  const r = opts.radius ?? 15
  const pts: { lat: number; lon: number }[] = []
  for (let i = 0; i < 16; i++) pts.push(proj.toLatLon(r * Math.cos((i * Math.PI) / 8), r * Math.sin((i * Math.PI) / 8)))
  pts.push(proj.toLatLon(-60, 0), proj.toLatLon(60, 0)) // 16 west, 17 east
  pts.push(proj.toLatLon(0, 0)) // 18 island centre
  const way = (id: number, nodes: number[], extra: Partial<OsmWay> = {}): OsmWay => ({
    id, kind: 'road', highway: 'residential', walkable: true, area: false, tunnel: false, crossing: false, nodes, safety: 0, ...extra,
  })
  const ways = [
    way(1, [...Array.from({ length: 16 }, (_, i) => i), 0], opts.tagged ? { roundabout: true } : {}),
    way(2, [16, 8], { kind: 'path', highway: 'footway' }),
    way(3, [0, 17], { kind: 'path', highway: 'footway' }),
  ]
  if (opts.through) ways.push(way(4, [8, 18, 0], { kind: 'path', highway: 'footway' }))
  return {
    bbox, lat: Float64Array.from(pts.map((p) => p.lat)), lon: Float64Array.from(pts.map((p) => p.lon)),
    ways, pois: [], source: 'fixture', timestamp: '',
  }
}

describe('roundabout detection', () => {
  it('detects a tagged ring and an untagged round ring', () => {
    expect(findRoundabouts(plaza({ tagged: true, through: false }))).toHaveLength(1)
    expect(findRoundabouts(plaza({ tagged: false, through: false }))).toHaveLength(1)
  })
  it('does not treat a big ring (a block) or a service loop as a roundabout unless tagged', () => {
    expect(findRoundabouts(plaza({ tagged: false, through: false, radius: 120 }))).toHaveLength(0)
    expect(findRoundabouts(plaza({ tagged: true, through: false, radius: 120 }))).toHaveLength(1)
    const data = plaza({ tagged: false, through: false })
    data.ways[0]!.highway = 'service'
    expect(findRoundabouts(data)).toHaveLength(0)
  })
  it('tests points against the island', () => {
    const [island] = findRoundabouts(plaza({ tagged: true, through: false }))
    expect(insidePolygon({ x: 0, y: 0 }, island!.xy)).toBe(true)
    expect(insidePolygon({ x: 40, y: 0 }, island!.xy)).toBe(false)
    expect(crossesIsland({ x: -30, y: 0 }, { x: 30, y: 0 }, [island!])).toBe(true)
    expect(crossesIsland({ x: -30, y: 40 }, { x: 30, y: 40 }, [island!])).toBe(false)
  })
  it('reads junction=roundabout from Overpass tags and keeps it through the codec', () => {
    const ids = [1, 2, 3, 4, 5, 1]
    const geometry = [[0, 0], [0, 1], [1, 1], [1, 0], [0.5, -0.5], [0, 0]].map(([a, b]) => ({ lat: 39.492 + a! * 1e-4, lon: -0.396 + b! * 1e-4 }))
    const json: OverpassResponse = { elements: [{ type: 'way', id: 9, nodes: ids, geometry, tags: { highway: 'residential', junction: 'circular' } }] }
    const data = normalizeOverpass(json, bbox)
    expect(data.ways[0]!.roundabout).toBe(true)
    expect(decodeOsm(encodeOsm(data)).ways[0]!.roundabout).toBe(true)
  })
  it('splits a way at nodes outside the box instead of joining the neighbours', () => {
    const json: OverpassResponse = {
      elements: [{
        type: 'way', id: 5, nodes: [1, 2, 3, 4], tags: { highway: 'footway' },
        geometry: [{ lat: 39.491, lon: -0.397 }, { lat: 39.491, lon: -0.396 }, null, { lat: 39.491, lon: -0.394 }],
      }],
    }
    expect(normalizeOverpass(json, bbox).ways).toHaveLength(1) // the lone node after the gap is dropped
  })
})

describe('split roundabouts', () => {
  it('stitches arcs tagged roundabout into one ring and routes around it', () => {
    const data = plaza({ tagged: true, through: true })
    const ring = data.ways[0]!
    const arcs = [ring.nodes.slice(0, 6), ring.nodes.slice(5, 12), ring.nodes.slice(11)]
    data.ways.splice(0, 1, ...arcs.map((nodes, i) => ({ ...ring, id: 100 + i, nodes })))
    const islands = findRoundabouts(data)
    expect(islands).toHaveLength(1)
    expect(islands[0]!.ring).toHaveLength(16)
    expect(islands[0]!.ways).toHaveLength(3)
    const g = new WalkGraph(data)
    const a = g.nearestNode(proj.toLatLon(-60, 0))!.node
    const b = g.nearestNode(proj.toLatLon(60, 0))!.node
    expect(g.shortestPath(a, b)!.length).toBeGreaterThan(130)
  })
  it('ignores arcs that do not close', () => {
    const data = plaza({ tagged: true, through: false })
    data.ways[0]!.nodes = data.ways[0]!.nodes.slice(0, 9)
    expect(findRoundabouts(data)).toHaveLength(0)
  })
})

describe('routing around islands', () => {
  it('drops a path mapped through the island and routes around the ring', () => {
    const data = plaza({ tagged: true, through: true })
    const g = new WalkGraph(data)
    const a = g.nearestNode(proj.toLatLon(-60, 0))!.node
    const b = g.nearestNode(proj.toLatLon(60, 0))!.node
    const route = g.shortestPath(a, b)!
    const islands = findRoundabouts(data)
    const xy = route.nodes.map((n) => proj.toXY(g.point(n)))
    for (let i = 1; i < xy.length; i++) expect(crossesIsland(xy[i - 1]!, xy[i]!, islands)).toBe(false)
    // Half the ring (π·15 ≈ 47 m) plus the two spokes, not the 120 m straight line.
    expect(route.length).toBeGreaterThan(120 + 10)
    expect(route.length).toBeLessThan(190)
  })
  it('does the same for an untagged ring', () => {
    const g = new WalkGraph(plaza({ tagged: false, through: true }))
    const a = g.nearestNode(proj.toLatLon(-60, 0))!.node
    const b = g.nearestNode(proj.toLatLon(60, 0))!.node
    expect(g.shortestPath(a, b)!.length).toBeGreaterThan(130)
  })
})

describe('Benicalap fixture', () => {
  const data = loadDemoOsm()
  const graph = new WalkGraph(data)
  const islands = findRoundabouts(data)
  const p = new LocalProjection({ lat: (data.bbox.north + data.bbox.south) / 2, lon: (data.bbox.east + data.bbox.west) / 2 })
  const xyOf = (n: number) => p.toXY(graph.point(n))

  it('finds roundabouts', () => {
    expect(islands.length).toBeGreaterThanOrEqual(5)
  })
  it('has no mapped walkable segment through an island (the filter is a safeguard here)', () => {
    let crossing = 0
    data.ways.forEach((way, wi) => {
      if (!way.walkable || islands.some((r) => r.ways.includes(wi))) return
      for (let i = 1; i < way.nodes.length; i++) {
        const a = p.toXY({ lat: data.lat[way.nodes[i - 1]!]!, lon: data.lon[way.nodes[i - 1]!]! })
        const b = p.toXY({ lat: data.lat[way.nodes[i]!]!, lon: data.lon[way.nodes[i]!]! })
        if (crossesIsland(a, b, islands)) crossing++
      }
    })
    expect(crossing).toBe(0)
  })
  it('has no graph edge through any island', () => {
    for (let n = 0; n < graph.size; n++) {
      for (let i = graph.offsets[n]!; i < graph.offsets[n + 1]!; i++) {
        const m = graph.targets[i]!
        if (m < n) continue
        if (islands.some((r) => r.ways.includes(graph.edgeWay[graph.edgeIds[i]!]!))) continue
        expect(crossesIsland(xyOf(n), xyOf(m), islands)).toBe(false)
      }
    }
  })
  it('routes between opposite sides of every roundabout without entering the island', () => {
    let checked = 0
    for (const island of islands) {
      const ids = island.ring.map((osm) => graph.nearestNode(data.lat[osm] !== undefined ? { lat: data.lat[osm]!, lon: data.lon[osm]! } : { lat: 0, lon: 0 })!.node)
      const a = ids[0]!
      const b = ids[Math.floor(ids.length / 2)]!
      if (a === b || graph.component[a] !== 0 || graph.component[b] !== 0) continue
      const route = graph.shortestPath(a, b)
      if (!route) continue
      checked++
      const xy = route.nodes.map(xyOf)
      for (let i = 1; i < xy.length; i++) expect(crossesIsland(xy[i - 1]!, xy[i]!, [island])).toBe(false)
    }
    expect(checked).toBeGreaterThanOrEqual(3)
  })
})
