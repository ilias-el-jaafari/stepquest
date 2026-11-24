import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LocalProjection } from '../geo/geo.ts'
import { findRoundabouts } from '../osm/roundabout.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { WalkGraph } from './graph.ts'

const SEED = 20261204
const bbox = { south: 39.49, west: -0.4, north: 39.4958, east: -0.392 }
const centre = { lat: 39.4929, lon: -0.396 }
const proj = new LocalProjection(centre)

const way = (id: number, nodes: number[], extra: Partial<OsmWay> = {}): OsmWay => ({
  id, kind: 'road', highway: 'residential', walkable: true, area: false, tunnel: false, crossing: false, nodes, safety: 0, ...extra,
})

type Plaza = {
  /** Ring node count and radius (m). */
  n: number
  radius: number
  /** Indices (0..n-1) at which the ring is cut into arcs; empty = one closed way. */
  splits: number[]
  /** Arcs whose direction is reversed. */
  reversed: boolean[]
  /** Ring node index where each entry road joins. */
  entries: number[]
  /** Optional footway across the island: ring node indices (gap ≥ n/4 apart) and whether it has a centre node. */
  across?: { a: number; b: number; viaCentre: boolean }
  tagged: boolean
}

const plazaArb: fc.Arbitrary<Plaza> = fc
  .integer({ min: 8, max: 40 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      radius: fc.double({ min: 8, max: 60, noNaN: true }),
      splits: fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { maxLength: 8 }).map((a) => a.sort((x, y) => x - y)),
      reversed: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
      entries: fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { minLength: 1, maxLength: 6 }),
      across: fc.option(
        fc.record({ a: fc.integer({ min: 0, max: n - 1 }), gap: fc.integer({ min: Math.ceil(n / 4), max: Math.floor(n / 2) }), viaCentre: fc.boolean() }).map(({ a, gap, viaCentre }) => ({ a, b: (a + gap) % n, viaCentre })),
        { nil: undefined },
      ),
      tagged: fc.constant(true),
    }),
  )

/** Ring arcs for the given splits (as node index lists, ring order, each starting/ending at a split). */
function arcsOf(n: number, splits: number[], reversed: boolean[]): number[][] {
  const ring = Array.from({ length: n }, (_, i) => i)
  if (splits.length === 0) return [[...ring, 0]]
  const arcs: number[][] = []
  splits.forEach((s, k) => {
    const e = splits[(k + 1) % splits.length]!
    const arc = [s]
    for (let i = (s + 1) % n; ; i = (i + 1) % n) {
      arc.push(i)
      if (i === e) break
    }
    if (splits.length === 1) arc.push(s) // a single cut: one closed way starting there
    arcs.push(reversed[k] ? arc.reverse() : arc)
  })
  return arcs
}

function build(p: Plaza, splits: number[] = p.splits): { data: OsmData; ringNodes: number[]; entryNodes: number[] } {
  const pts: { lat: number; lon: number }[] = []
  for (let i = 0; i < p.n; i++) pts.push(proj.toLatLon(p.radius * Math.cos((2 * Math.PI * i) / p.n), p.radius * Math.sin((2 * Math.PI * i) / p.n)))
  const centreNode = pts.length
  pts.push(proj.toLatLon(0, 0))
  const ways: OsmWay[] = arcsOf(p.n, splits, p.reversed).map((nodes, i) => way(100 + i, nodes, { roundabout: p.tagged }))
  // Entry roads: radial, from 80 m outside the ring, to the ring node.
  const entryNodes: number[] = []
  p.entries.forEach((ring, i) => {
    const angle = (2 * Math.PI * ring) / p.n
    const far = pts.length
    pts.push(proj.toLatLon((p.radius + 80) * Math.cos(angle), (p.radius + 80) * Math.sin(angle)))
    entryNodes.push(far)
    ways.push(way(200 + i, [far, ring], { kind: 'path', highway: 'footway' }))
  })
  if (p.across) ways.push(way(300, p.across.viaCentre ? [p.across.a, centreNode, p.across.b] : [p.across.a, p.across.b], { kind: 'path', highway: 'footway' }))
  const data: OsmData = { bbox, lat: Float64Array.from(pts.map((q) => q.lat)), lon: Float64Array.from(pts.map((q) => q.lon)), ways, pois: [], source: 'fixture', timestamp: '' }
  return { data, ringNodes: Array.from({ length: p.n }, (_, i) => i), entryNodes }
}

/** Graph node id of an OSM node index (nodes are matched by coordinates). */
function graphNode(g: WalkGraph, data: OsmData, osm: number): number | undefined {
  for (let i = 0; i < g.size; i++) if (g.lat[i] === data.lat[osm] && g.lon[i] === data.lon[osm]) return i
  return undefined
}

describe('roundabout properties', () => {
  it('P-RA1: no walking-graph edge runs through the island, and the ring stays connected to its entries', () => {
    fc.assert(
      fc.property(plazaArb, (p) => {
        const { data, ringNodes, entryNodes } = build(p)
        const g = new WalkGraph(data)
        // Independent geometry: the ring is a regular polygon, so its island is the disc of the in-radius.
        const inradius = p.radius * Math.cos(Math.PI / p.n)
        const xy = (node: number) => proj.toXY({ lat: g.lat[node]!, lon: g.lon[node]! })
        for (let a = 0; a < g.size; a++) {
          for (let i = g.offsets[a]!; i < g.offsets[a + 1]!; i++) {
            const b = g.targets[i]!
            for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
              const pa = xy(a)
              const pb = xy(b)
              const depth = inradius - Math.hypot(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t)
              expect(depth, 'edge sample deeper than 0.5 m inside the island').toBeLessThanOrEqual(0.5)
            }
          }
        }
        // Ring connectivity: every ring edge and every entry road is still in the graph, in one component.
        const nodes = ringNodes.map((r) => graphNode(g, data, r))
        expect(nodes.every((n) => n !== undefined)).toBe(true)
        const comp = g.component[nodes[0]!]
        for (const n of nodes) expect(g.component[n!]).toBe(comp)
        for (const e of entryNodes) expect(g.component[graphNode(g, data, e)!]).toBe(comp)
        for (let r = 0; r < p.n; r++) {
          const a = nodes[r]!
          const b = nodes[(r + 1) % p.n]!
          expect(g.edgeLength(a, b)).toBeGreaterThan(0)
          let found = false
          for (let i = g.offsets[a]!; i < g.offsets[a + 1]!; i++) if (g.targets[i] === b) found = true
          expect(found, `ring edge ${r}`).toBe(true)
        }
        // A footway across the island is removed (it has no way around except the ring).
        if (p.across && p.across.viaCentre) expect(g.edgeCount).toBe(p.n + p.entries.length)
      }),
      { seed: SEED, numRuns: 60 },
    )
  })

  it('P-RA2: detection is invariant to how the ring is split into ways', () => {
    const plazaWithOtherSplit = plazaArb.chain((p) =>
      fc.record({ p: fc.constant(p), other: fc.uniqueArray(fc.integer({ min: 0, max: p.n - 1 }), { maxLength: 8 }).map((a) => a.sort((x, y) => x - y)) }),
    )
    fc.assert(
      fc.property(plazaWithOtherSplit, ({ p, other }) => {
        const a = findRoundabouts(build(p).data)
        const b = findRoundabouts(build(p, other).data)
        expect(a).toHaveLength(1)
        expect(b).toHaveLength(1)
        // Same ring node set and same island polygon area, whatever the cut points or arc directions.
        expect([...a[0]!.ring].sort((x, y) => x - y)).toEqual([...b[0]!.ring].sort((x, y) => x - y))
        expect(a[0]!.ring).toHaveLength(p.n)
        const area = (r: { xy: { x: number; y: number }[] }) => Math.abs(r.xy.reduce((s, q, i) => s + q.x * r.xy[(i + 1) % r.xy.length]!.y - r.xy[(i + 1) % r.xy.length]!.x * q.y, 0) / 2)
        expect(area(a[0]!)).toBeCloseTo(area(b[0]!), 6)
        // And the walking graph is the same.
        const ga = new WalkGraph(build(p).data)
        const gb = new WalkGraph(build(p, other).data)
        expect(gb.edgeCount).toBe(ga.edgeCount)
        expect(gb.size).toBe(ga.size)
      }),
      { seed: SEED, numRuns: 60 },
    )
  })

  it('P-RA2: an untagged, single, round ring is detected when it is 20-220 m around', () => {
    fc.assert(
      fc.property(plazaArb, (p) => {
        const q: Plaza = { ...p, tagged: false, splits: [], radius: Math.min(30, Math.max(5, p.radius)), n: Math.max(p.n, 12), entries: [0], across: undefined }
        const found = findRoundabouts(build(q).data)
        expect(found).toHaveLength(1)
      }),
      { seed: SEED, numRuns: 30 },
    )
  })
})
