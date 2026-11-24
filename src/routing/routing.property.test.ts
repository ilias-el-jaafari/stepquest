import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { cumulativeDistances, MAX_CHECKPOINTS, placeCheckpoints, pointAlong } from './checkpoints.ts'
import { WalkGraph } from './graph.ts'
import { planRoute, type Route, type RouteRequest } from './planner.ts'
import { planWithSafety } from './safePlanner.ts'
import { edgeCosts, MAX_FACTOR, MIN_FACTOR, safetyContext, type SafetyContext } from './safety.ts'

// Fixed seed: a failure prints the seed and the counterexample, and reruns identically.
const SEED = 20261204
const area = DEMO_AREA.bbox

let graph: WalkGraph
let ctx: SafetyContext

beforeAll(() => {
  const data = loadDemoOsm()
  graph = new WalkGraph(data)
  ctx = safetyContext(graph, data)
})

/** A start point inside the middle of the demo box (planning is slow near the clipped edges). */
const startArb = fc
  .record({ a: fc.double({ min: 0.2, max: 0.8, noNaN: true }), b: fc.double({ min: 0.2, max: 0.8, noNaN: true }) })
  .map(({ a, b }): LatLon => ({ lat: area.south + (area.north - area.south) * a, lon: area.west + (area.east - area.west) * b }))
const strideArb = fc.double({ min: 0.5, max: 1.0, noNaN: true })
const stepsArb = fc.integer({ min: 1500, max: 14_000 })
const seedArb = fc.integer({ min: 0, max: 50 })
const requestArb = fc
  .record({ mode: fc.constantFrom('loop', 'oneway'), start: startArb, end: startArb, targetSteps: stepsArb, strideM: strideArb, seed: seedArb })
  .map((r): RouteRequest => ({ ...r, mode: r.mode as RouteRequest['mode'] }))

function adjacent(a: number, b: number): boolean {
  for (let i = graph.offsets[a]!; i < graph.offsets[a + 1]!; i++) if (graph.targets[i] === b) return true
  return false
}

function realLength(nodes: number[]): number {
  let sum = 0
  for (let i = 1; i < nodes.length; i++) sum += graph.edgeLength(nodes[i - 1]!, nodes[i]!)
  return sum
}

function checkRoute(route: Route, req: RouteRequest) {
  // A chain of adjacent graph edges whose real lengths add up to the stated distance.
  expect(route.nodes.length).toBeGreaterThanOrEqual(2)
  for (let i = 1; i < route.nodes.length; i++) expect(adjacent(route.nodes[i - 1]!, route.nodes[i]!)).toBe(true)
  expect(route.distanceM).toBeCloseTo(realLength(route.nodes), 6)
  expect(route.points).toHaveLength(route.nodes.length)
  if (req.mode === 'loop') expect(route.nodes[0]).toBe(route.nodes.at(-1))
  // Within ±5 % of the goal.
  const targetM = stepsToMetres(req.targetSteps, req.strideM)
  expect(Math.abs(route.distanceM - targetM) / targetM).toBeLessThanOrEqual(0.05 + 1e-9)
  checkGems(route)
}

function checkGems(route: Route) {
  const cum = cumulativeDistances(route.points)
  const total = cum.at(-1)!
  const n = route.checkpoints.length
  expect(n).toBeGreaterThanOrEqual(1)
  expect(n).toBeLessThanOrEqual(MAX_CHECKPOINTS)
  let prev = 0
  route.checkpoints.forEach((c, k) => {
    expect(c.index).toBe(k + 1)
    // In order along the route, evenly spaced: gem k sits at k/N of the length.
    expect(c.distanceM).toBeGreaterThan(prev)
    expect(Math.abs(c.distanceM - (total * (k + 1)) / n)).toBeLessThanOrEqual(1e-6 * total + 1e-9)
    prev = c.distanceM
    // And the gem is really on the polyline at that distance.
    expect(haversine(c.point, pointAlong(route.points, cum, c.distanceM))).toBeLessThan(0.01)
    expect(c.isFinish).toBe(k === n - 1)
  })
  expect(haversine(route.checkpoints.at(-1)!.point, route.points.at(-1)!)).toBeLessThan(0.01)
}

describe('routing properties (Benicalap fixture)', () => {
  it('P-R1/R2/R3: a plan is within ±5 % of the goal or reported infeasible; it is a chain of graph edges with ordered, evenly spaced gems', () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const result = planRoute(graph, req, area)
        if (!result.ok) {
          expect(result.reason).toBeTruthy()
          if (result.reason === 'tooShort') expect(result.minSteps).toBeGreaterThan(0)
          if (result.closest) expect(result.closest.withinTolerance).toBe(false)
          return
        }
        expect(result.route.withinTolerance).toBe(true)
        checkRoute(result.route, req)
        if (req.mode === 'oneway') {
          // Starts and ends at the snapped points.
          expect(haversine(result.route.points[0]!, req.start)).toBeLessThan(150)
          expect(haversine(result.route.points.at(-1)!, req.end!)).toBeLessThan(150)
        }
      }),
      { seed: SEED, numRuns: 60 },
    )
  })

  it('P-R4: safety weights, night and avoided streets never change the real length of a route', () => {
    const names = [...new Set(ctx.names.filter((n): n is string => !!n))].slice(0, 40)
    const optsArb = fc.record({ safe: fc.boolean(), night: fc.boolean(), avoid: fc.subarray(names, { maxLength: 3 }) })
    fc.assert(
      fc.property(requestArb, optsArb, (req, opts) => {
        const plan = planWithSafety(graph, ctx, req, area, opts)
        const route = plan.result.ok ? plan.result.route : plan.result.closest
        if (!route) return
        expect(route.distanceM).toBeCloseTo(realLength(route.nodes), 6)
        expect(route.distanceM).toBeCloseTo(cumulativeDistances(route.points).at(-1)!, 6)
        // Steps follow from the real length, not from the weighted cost.
        expect(Math.abs(route.steps - route.distanceM / req.strideM)).toBeLessThanOrEqual(0.5 + 1e-9)
        for (let i = 1; i < route.nodes.length; i++) expect(adjacent(route.nodes[i - 1]!, route.nodes[i]!)).toBe(true)
      }),
      { seed: SEED, numRuns: 40 },
    )
  })

  it('P-R4: a weighted shortest path reports the sum of real edge lengths, whatever the weights', () => {
    const nodeArb = fc.integer({ min: 0, max: graph.size - 1 })
    fc.assert(
      fc.property(nodeArb, nodeArb, fc.integer({ min: 1, max: 2 ** 30 }), (from, to, salt) => {
        const penalty = new Float32Array(graph.edgeCount)
        for (let e = 0; e < penalty.length; e++) penalty[e] = 1 + ((Math.imul(e, 2654435761) ^ salt) >>> 0) % 7
        const path = graph.shortestPath(from, to, penalty)
        if (!path) return
        expect(path.length).toBeCloseTo(realLength(path.nodes), 6)
        expect(path.edges).toHaveLength(path.nodes.length - 1)
        // Weights can only make the path no shorter than the unweighted shortest one.
        const plain = graph.shortestPath(from, to)!
        expect(path.length).toBeGreaterThanOrEqual(plain.length - 1e-6)
      }),
      { seed: SEED, numRuns: 25 },
    )
  })

  it('P-R4: safety edge costs stay in the documented range and avoided streets are closed', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (safe, night) => {
        const costs = edgeCosts(ctx, { safe, night, avoid: [] })
        if (!costs) {
          expect(safe).toBe(false)
          return
        }
        expect(costs.cost).toHaveLength(graph.edgeCount)
        for (const c of costs.cost) {
          // costs are stored as float32, `min` as float64: compare after rounding
          expect(c).toBeGreaterThanOrEqual(Math.fround(costs.min))
          expect(c).toBeLessThanOrEqual(Math.fround(MAX_FACTOR))
          expect(Number.isFinite(c)).toBe(true)
        }
        expect(costs.min).toBeGreaterThanOrEqual(MIN_FACTOR - 1e-9)
      }),
      { seed: SEED, numRuns: 4 },
    )
  })
})

describe('checkpoint properties', () => {
  const polyline = fc
    .array(fc.record({ d: fc.double({ min: 1, max: 400, noNaN: true }), b: fc.double({ min: 0, max: 360, noNaN: true }) }), { minLength: 1, maxLength: 40 })
    .map((steps) => steps.reduce<LatLon[]>((pts, s) => [...pts, destination(pts.at(-1)!, s.b, s.d)], [DEMO_AREA.center]))

  it('P-R3: gems are strictly ordered, evenly spaced, and the last one is the finish', () => {
    fc.assert(
      fc.property(polyline, fc.integer({ min: 1, max: 60 }), (points, count) => {
        const gems = placeCheckpoints(points, count)
        const n = Math.min(count, MAX_CHECKPOINTS)
        expect(gems).toHaveLength(n)
        const total = cumulativeDistances(points).at(-1)!
        const gaps = gems.map((g, i) => g.distanceM - (i ? gems[i - 1]!.distanceM : 0))
        for (const gap of gaps) expect(Math.abs(gap - total / n)).toBeLessThanOrEqual(1e-6 * total)
        expect(gems.at(-1)!.isFinish).toBe(true)
        expect(gems.at(-1)!.distanceM).toBeCloseTo(total, 6)
      }),
      { seed: SEED, numRuns: 100 },
    )
  })
})
