import { beforeAll, describe, expect, it } from 'vitest'
import { LocalProjection } from '../geo/geo.ts'
import { MAX_STEPS, MIN_STEPS } from '../geo/steps.ts'
import { isWalkable } from '../osm/classify.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { normalizeOverpass, type OverpassResponse } from '../osm/normalize.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { WalkGraph } from './graph.ts'
import { planRoute, type RouteRequest } from './planner.ts'
import { MAX_PLAZA_NODES, plazaChords } from './plazaChords.ts'
import { edgeCosts, safetyContext } from './safety.ts'

/** Regression tests from the Nov 2026 routing review (tasks 61.x in .kiro/specs/routing/tasks.md). */

const area = DEMO_AREA.bbox
const base = { start: DEMO_AREA.defaultStart, end: DEMO_AREA.defaultEnd, strideM: 0.75 }
let data: OsmData
let graph: WalkGraph

beforeAll(() => {
  data = loadDemoOsm()
  graph = new WalkGraph(data)
})

// ---------------------------------------------------------------------------
// Synthetic maps
// ---------------------------------------------------------------------------

const bbox = { south: 39.49, west: -0.4, north: 39.4958, east: -0.392 }
const proj = new LocalProjection({ lat: 39.4929, lon: -0.396 })

function way(id: number, nodes: number[], extra: Partial<OsmWay> = {}): OsmWay {
  return { id, kind: 'path', highway: 'footway', walkable: true, area: false, tunnel: false, crossing: false, nodes, safety: 0, ...extra }
}

/** Build OsmData from local x/y points in metres (east, north of the box centre). */
function synthetic(points: [number, number][], ways: OsmWay[]): OsmData {
  const ll = points.map(([x, y]) => proj.toLatLon(x, y))
  return {
    bbox,
    lat: Float64Array.from(ll.map((p) => p.lat)),
    lon: Float64Array.from(ll.map((p) => p.lon)),
    ways,
    pois: [],
    source: 'fixture',
    timestamp: '',
  }
}

const edgeSet = (g: WalkGraph) => {
  const out: string[] = []
  for (let n = 0; n < g.size; n++) {
    for (let i = g.offsets[n]!; i < g.offsets[n + 1]!; i++) {
      const m = g.targets[i]!
      if (n < m) out.push(`${g.lat[n]},${g.lon[n]}|${g.lat[m]},${g.lon[m]}`)
    }
  }
  return out.sort()
}

// ---------------------------------------------------------------------------
// 61.1 / 61.2: infeasible loop results always explain themselves
// ---------------------------------------------------------------------------

describe('loop infeasible results (61.1, 61.2)', () => {
  const loop = (targetSteps: number, seed = 0) => planRoute(graph, { ...base, mode: 'loop', targetSteps, seed }, area)

  it('reports "too short" with the fewest steps a loop can have when the goal is below the smallest loop', () => {
    const r = loop(MIN_STEPS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('tooShort')
    expect(r.minSteps).toBeGreaterThan(MIN_STEPS)
    // The hint is a number that really works.
    const again = loop(r.minSteps!)
    expect(again.ok, JSON.stringify(again.ok ? '' : again.reason)).toBe(true)
  })

  it('carries both a minimum and a maximum hint on every infeasible loop with an attempt', () => {
    for (const steps of [MIN_STEPS, 110, 60_000]) {
      const r = loop(steps)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.closest, `closest for ${steps}`).toBeDefined()
      expect(r.minSteps, `minSteps for ${steps}`).toBeDefined()
      expect(r.maxSteps, `maxSteps for ${steps}`).toBeDefined()
      expect(r.minSteps!).toBeLessThanOrEqual(r.maxSteps!)
    }
  })

  it('"too long" hints at the longest loop found and that number is feasible', () => {
    const r = loop(60_000)
    expect(r).toMatchObject({ ok: false, reason: 'tooLong' })
    if (r.ok) return
    expect(r.maxSteps!).toBeLessThan(60_000)
    expect(r.maxSteps!).toBeGreaterThanOrEqual(r.closest!.steps)
  })
})

// ---------------------------------------------------------------------------
// 61.3: step-count range guard
// ---------------------------------------------------------------------------

describe('step range guard (61.3)', () => {
  const bad = [0, -5, 50, MIN_STEPS - 1, MAX_STEPS + 1, 200_000, Number.NaN, Infinity]
  for (const mode of ['loop', 'oneway'] as const) {
    it(`${mode}: rejects out-of-range goals at once with the allowed bounds, before any search`, () => {
      let searched = 0
      const sp = graph.shortestPath.bind(graph)
      graph.shortestPath = (...a) => (searched++, sp(...a))
      try {
        for (const targetSteps of bad) {
          const r = planRoute(graph, { ...base, mode, targetSteps }, area)
          expect(r, String(targetSteps)).toMatchObject({ ok: false, reason: 'outOfRange', minSteps: MIN_STEPS, maxSteps: MAX_STEPS })
        }
        expect(searched).toBe(0)
      } finally {
        graph.shortestPath = sp
      }
    })
  }
  it('still plans at the bounds themselves', () => {
    const r = planRoute(graph, { ...base, mode: 'loop', targetSteps: 150 }, area)
    expect(r.ok).toBe(true)
    const big = planRoute(graph, { ...base, mode: 'loop', targetSteps: MAX_STEPS }, area)
    expect(big.ok || big.reason === 'tooLong').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 61.4: empty and degenerate graphs, islands, unreachable targets
// ---------------------------------------------------------------------------

describe('degenerate graphs (61.4)', () => {
  it('an empty map builds a zero-size graph and every plan is "unreachable"', () => {
    const empty = new WalkGraph(synthetic([], []))
    expect(empty.size).toBe(0)
    expect(empty.nearestNode({ lat: 39.4929, lon: -0.396 })).toBeUndefined()
    for (const mode of ['loop', 'oneway'] as const) {
      const r = planRoute(empty, { mode, start: { lat: 39.4929, lon: -0.396 }, end: { lat: 39.4935, lon: -0.395 }, targetSteps: 3000, strideM: 0.75 }, bbox)
      expect(r).toMatchObject({ ok: false, reason: 'unreachable' })
    }
  })
  it('a map whose only ways are not walkable is empty too', () => {
    const g = new WalkGraph(synthetic([[0, 0], [50, 0]], [way(1, [0, 1], { kind: 'road', highway: 'motorway', walkable: false })]))
    expect(g.size).toBe(0)
  })
  it('a start on a disconnected footway island snaps to the main network, never to the island', () => {
    // Main street along y=0 (x −300…300); a 20 m island footway at y=200 (nearest to the tap).
    const data2 = synthetic(
      [[-300, 0], [0, 0], [300, 0], [-10, 200], [10, 200]],
      [way(1, [0, 1, 2], { kind: 'road', highway: 'residential' }), way(2, [3, 4])],
    )
    const g = new WalkGraph(data2)
    const tap = proj.toLatLon(0, 190)
    const snap = g.nearestNode(tap)!
    expect(g.component[snap.node]).toBe(0)
    expect(snap.distance).toBeGreaterThan(150)
    // …which is beyond the snap limit, so the plan says so instead of starting on the island.
    const r = planRoute(g, { mode: 'loop', start: tap, targetSteps: 1000, strideM: 0.75 }, bbox)
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' })
  })
  it('A→B with the finish cut off by closed streets is "unreachable", not a hang or a crash', () => {
    const b = graph.nearestNode(DEMO_AREA.defaultEnd)!.node
    const cost = new Float32Array(graph.edgeCount).fill(1)
    for (let i = graph.offsets[b]!; i < graph.offsets[b + 1]!; i++) cost[graph.edgeIds[i]!] = Infinity
    const r = planRoute(graph, { ...base, mode: 'oneway', targetSteps: 6000, cost, minCost: 1 }, area)
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' })
  })
  it('a loop whose start is walled in by closed streets finds nothing but still answers', () => {
    const a = graph.nearestNode(DEMO_AREA.defaultStart)!.node
    const cost = new Float32Array(graph.edgeCount).fill(1)
    for (let i = graph.offsets[a]!; i < graph.offsets[a + 1]!; i++) cost[graph.edgeIds[i]!] = Infinity
    const r = planRoute(graph, { ...base, mode: 'loop', targetSteps: 5000, cost, minCost: 1 }, area)
    expect(r.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 61.5: exclusion rules are shared and visible in the graph
// ---------------------------------------------------------------------------

describe('walkability exclusions (61.5)', () => {
  const cases: [Record<string, string>, boolean][] = [
    [{ highway: 'residential' }, true],
    [{ highway: 'footway', access: 'private' }, false],
    [{ highway: 'footway', access: 'no' }, false],
    [{ highway: 'residential', foot: 'no' }, false],
    [{ highway: 'residential', foot: 'use_sidepath' }, false],
    [{ highway: 'residential', foot: 'private' }, false],
    [{ highway: 'service', access: 'no', foot: 'yes' }, true],
    [{ highway: 'path', access: 'private', foot: 'permissive' }, true],
    [{ highway: 'steps' }, true],
    [{ highway: 'steps', access: 'private' }, false],
    [{ highway: 'pedestrian', area: 'yes' }, true],
    [{ highway: 'motorway' }, false],
    [{ highway: 'trunk', foot: 'no' }, false],
    [{ highway: 'cycleway' }, false],
    [{ highway: 'cycleway', foot: 'designated' }, true],
    [{ highway: 'construction' }, false],
    [{ highway: 'elevator' }, false],
    [{ railway: 'tram', highway: 'footway' }, false],
    [{ place: 'square' }, false],
  ]
  for (const [tags, walkable] of cases) {
    it(`${JSON.stringify(tags)} is ${walkable ? '' : 'not '}walkable`, () => {
      expect(isWalkable(tags)).toBe(walkable)
    })
  }

  it('excluded ways never become graph edges (end to end through the Overpass normaliser)', () => {
    const el = (id: number, a: number, tags: Record<string, string>) => ({
      type: 'way' as const,
      id,
      nodes: [a, a + 1],
      geometry: [
        { lat: 39.4929 + id * 1e-4, lon: -0.396 },
        { lat: 39.4929 + id * 1e-4, lon: -0.3955 },
      ],
      tags,
    })
    const json: OverpassResponse = {
      elements: [
        el(1, 10, { highway: 'residential' }),
        el(2, 20, { highway: 'footway', access: 'private' }),
        el(3, 30, { highway: 'footway', access: 'no' }),
        el(4, 40, { highway: 'residential', foot: 'no' }),
        el(5, 50, { highway: 'path', foot: 'use_sidepath' }),
        el(6, 60, { highway: 'steps' }),
      ],
    }
    const g = new WalkGraph(normalizeOverpass(json, bbox))
    // Only the residential street (id 1) and the steps (id 6) are routable: two edges.
    expect(g.edgeCount).toBe(2)
  })

  it('every edge of the Benicalap graph belongs to a walkable way', () => {
    for (let e = 0; e < graph.edgeCount; e++) expect(data.ways[graph.edgeWay[e]!]!.walkable).toBe(true)
  })

  it('two graphs built from the same data have identical edge sets', () => {
    expect(edgeSet(new WalkGraph(data))).toEqual(edgeSet(graph))
  })
})

// ---------------------------------------------------------------------------
// 61.6: crossings stay in the graph and do not change safety costs
// ---------------------------------------------------------------------------

describe('crossings (61.6)', () => {
  it('a marked crossing is the only link between two footways on either side of a road, and it is routable', () => {
    // North sidewalk y=+8, south sidewalk y=−8; the road y=0 is not connected to either. The crossing joins them.
    const d = synthetic(
      [[-40, 8], [0, 8], [40, 8], [-40, -8], [0, -8], [40, -8], [-40, 0], [40, 0]],
      [
        way(1, [0, 1, 2]),
        way(2, [3, 4, 5]),
        way(3, [1, 4], { crossing: true }),
        way(4, [6, 7], { kind: 'road', highway: 'residential' }),
      ],
    )
    const g = new WalkGraph(d)
    const north = g.nearestNode(proj.toLatLon(-40, 8))!.node
    const south = g.nearestNode(proj.toLatLon(40, -8))!.node
    expect(g.component[north]).toBe(g.component[south])
    const path = g.shortestPath(north, south)
    expect(path).toBeDefined()
    expect(path!.length).toBeGreaterThan(80)
    // Without the crossing way the two sides are separate islands.
    const without = new WalkGraph({ ...d, ways: d.ways.filter((w) => !w.crossing) })
    const a = without.nearestNode(proj.toLatLon(-40, 8), false)!.node
    const b = without.nearestNode(proj.toLatLon(40, -8), false)!.node
    expect(without.shortestPath(a, b)).toBeUndefined()
  })

  it('every marked crossing of the fixture is in the graph with its nodes shared with the streets it crosses', () => {
    const crossings = data.ways.map((w, i) => ({ w, i })).filter(({ w }) => w.walkable && w.crossing)
    expect(crossings.length).toBeGreaterThan(100)
    const present = new Set<number>()
    for (let e = 0; e < graph.edgeCount; e++) present.add(graph.edgeWay[e]!)
    const inBox = (n: number) => data.lat[n]! >= area.south && data.lat[n]! <= area.north && data.lon[n]! >= area.west && data.lon[n]! <= area.east
    const expected = crossings.filter(({ w }) => w.nodes.every(inBox) && new Set(w.nodes).size > 1)
    expect(expected.length).toBeGreaterThan(100)
    for (const { i } of expected) expect(present.has(i), `crossing way ${data.ways[i]!.id}`).toBe(true)
    // Almost all of them hang on the main network (a crossing nobody can reach is a data hole).
    let inMain = 0
    const crossingEdgeNode = new Set<number>()
    for (let n = 0; n < graph.size; n++) {
      for (let i = graph.offsets[n]!; i < graph.offsets[n + 1]!; i++) {
        if (data.ways[graph.edgeWay[graph.edgeIds[i]!]!]!.crossing) crossingEdgeNode.add(n)
      }
    }
    for (const n of crossingEdgeNode) if (graph.component[n] === 0) inMain++
    expect(inMain / crossingEdgeNode.size).toBeGreaterThan(0.9)
  })

  it('safety weights do not depend on the crossing flag (product decision: weights unchanged)', () => {
    const mk = (crossing: boolean) => {
      const d = synthetic([[0, 0], [50, 0]], [way(1, [0, 1], { kind: 'road', highway: 'residential', crossing, safety: 1 })])
      const g = new WalkGraph(d)
      return edgeCosts(safetyContext(g, d), { safe: true, night: true, avoid: [] })!.cost[0]
    }
    expect(mk(true)).toBe(mk(false))
  })
})

// ---------------------------------------------------------------------------
// 61.7: pedestrian plazas can be crossed
// ---------------------------------------------------------------------------

describe('pedestrian plazas (61.7)', () => {
  const plazaWay = (nodes: number[]) => way(1, nodes, { highway: 'pedestrian', area: true, sub: 'plaza' })

  it('a walker crosses a square diagonally instead of walking round it', () => {
    // 60 m square, corners 0..3, closed ring.
    const d = synthetic([[-30, -30], [30, -30], [30, 30], [-30, 30]], [plazaWay([0, 1, 2, 3, 0])])
    const g = new WalkGraph(d)
    const a = g.nearestNode(proj.toLatLon(-30, -30))!.node
    const b = g.nearestNode(proj.toLatLon(30, 30))!.node
    const path = g.shortestPath(a, b)!
    const diagonal = Math.hypot(60, 60)
    expect(path.length).toBeGreaterThan(diagonal * 0.99)
    expect(path.length).toBeLessThan(diagonal * 1.02)
  })

  it('never cuts across the notch of a concave plaza', () => {
    // U shape opening upward: the two tips are 60 m apart in a straight line through the notch (outside).
    const pts: [number, number][] = [[-30, 0], [-30, 40], [-10, 40], [-10, 10], [10, 10], [10, 40], [30, 40], [30, 0]]
    const d = synthetic(pts, [plazaWay([0, 1, 2, 3, 4, 5, 6, 7, 0])])
    const g = new WalkGraph(d)
    const left = g.nearestNode(proj.toLatLon(-30, 40))!.node
    const right = g.nearestNode(proj.toLatLon(30, 40))!.node
    const path = g.shortestPath(left, right)!
    // Straight line is 60 m; the shortest legal walk dips below the notch floor (y = 10).
    expect(path.length).toBeGreaterThan(90)
    // And every edge stays inside the polygon (midpoint test).
    const xy = pts.map(([x, y]) => ({ x, y }))
    const inside = (p: { x: number; y: number }) => {
      let ins = false
      for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
        const A = xy[i]!
        const B = xy[j]!
        if (A.y > p.y !== B.y > p.y && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) ins = !ins
      }
      return ins
    }
    for (let n = 0; n < g.size; n++) {
      for (let i = g.offsets[n]!; i < g.offsets[n + 1]!; i++) {
        const m = g.targets[i]!
        const p = proj.toXY(g.point(n))
        const q = proj.toXY(g.point(m))
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
        // Ring edges lie on the boundary; chords (everything else) must run inside.
        const isRingEdge = Math.abs(m - n) === 1 || Math.abs(m - n) === pts.length - 1
        if (!isRingEdge) expect(inside(mid)).toBe(true)
      }
    }
  })

  it('plazas of the Benicalap fixture add chords and every plan still meets its goal', () => {
    const areas = data.ways.filter((w) => w.walkable && w.area)
    expect(areas.length).toBeGreaterThan(5)
    const ringEdges = new Set<string>()
    for (const w of areas) for (let i = 1; i < w.nodes.length; i++) ringEdges.add([w.nodes[i - 1], w.nodes[i]].sort().join(':'))
    // Edges whose way is a plaza polygon but which are not ring segments are the chords.
    let chords = 0
    for (let e = 0; e < graph.edgeCount; e++) if (data.ways[graph.edgeWay[e]!]!.area) chords++
    let ring = 0
    for (const w of areas) ring += w.nodes.length - 1
    expect(chords).toBeGreaterThan(ring)
    const req: RouteRequest = { ...base, mode: 'oneway', targetSteps: 6000 }
    expect(planRoute(graph, req, area).ok).toBe(true)
  })
})

describe('plazaChords (61.7)', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  it('finds the two diagonals of a square and nothing for a triangle', () => {
    expect(plazaChords(sq)).toEqual([[0, 2], [1, 3]])
    expect(plazaChords(sq.slice(0, 3))).toEqual([])
  })
  it('skips chords that leave a concave polygon', () => {
    // L shape: the chord between the two arm tips (index 1 and 5) leaves the polygon.
    const l = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 20 }, { x: 0, y: 20 }]
    const chords = plazaChords(l).map((c) => c.join('-'))
    expect(chords).not.toContain('1-5')
    expect(chords).not.toContain('2-4')
    expect(chords).toContain('0-2')
  })
  it('stays bounded on a big ring by thinning it', () => {
    const big = Array.from({ length: 400 }, (_, i) => ({ x: 100 * Math.cos((i / 400) * 2 * Math.PI), y: 100 * Math.sin((i / 400) * 2 * Math.PI) }))
    const chords = plazaChords(big)
    expect(chords.length).toBeGreaterThan(0)
    expect(chords.length).toBeLessThanOrEqual((MAX_PLAZA_NODES * MAX_PLAZA_NODES) / 2)
  })
})
