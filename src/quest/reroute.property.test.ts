import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { metresToSteps, TARGET_TOLERANCE } from '../geo/steps.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planRoute } from '../routing/planner.ts'
import { safetyContext } from '../routing/safety.ts'
import { applyFix, createQuest, trackFor, type QuestState } from './quest.ts'
import { planReroute } from './reroute.ts'
import { pointAt } from './testWalk.testutil.ts'
import type { QuestRoute } from './types.ts'

const SEED = 20261204
const NOW = Date.UTC(2026, 10, 22, 12)
const data = loadDemoOsm()
const graph = new WalkGraph(data)
const ctx = safetyContext(graph, data)
const world = { graph, ctx, data, bbox: DEMO_AREA.bbox }

function routeFor(seed: number, targetSteps: number): QuestRoute | undefined {
  const planned = planRoute(graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps, strideM: 0.75, seed }, DEMO_AREA.bbox)
  if (!planned.ok) return undefined
  const r = planned.route
  return { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }
}
const routes = [routeFor(1, 10_000), routeFor(3, 6000), routeFor(7, 8000)].filter((r): r is QuestRoute => !!r)

/** The walker followed the route for `walkM` metres (every 10 m, as the GPS would) and is now at `off`, away from it. */
function walkerOff(route: QuestRoute, walkM: number, bearing: number, offsetM: number): QuestState {
  let q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 'prop' })
  const track = trackFor(route)
  let t = 0
  for (let d = 10; d <= walkM; d += 10) q = applyFix(q, { ...pointAt(track.points, track.cumulative, d), accuracy: 5, timestamp: (t += 8000) }).state
  return { ...q, player: destination(q.player!, bearing, offsetM), offRoute: true }
}

const remainingOf = (q: QuestState) => q.route.targetSteps - metresToSteps(q.odometer.totalM, q.strideM)

describe('rerouting properties (Benicalap fixture)', () => {
  it('has routes to test', () => {
    expect(routes.length).toBeGreaterThanOrEqual(2)
  })

  it('P-RR1/P-RR2/P-RR3: a reroute keeps uncollected gems in order, never joins behind the walker, and keeps the step budget within ±5 % (local) or replans fully', () => {
    const caseArb = fc.record({
      route: fc.constantFrom(...routes),
      frac: fc.double({ min: 0.03, max: 0.85, noNaN: true }),
      bearing: fc.double({ min: 0, max: 360, noNaN: true }),
      offset: fc.double({ min: 25, max: 120, noNaN: true }),
      local: fc.boolean(),
    })
    let kinds = { local: 0, full: 0, none: 0 }
    fc.assert(
      fc.property(caseArb, ({ route, frac, bearing, offset, local }) => {
        const q = walkerOff(route, route.distanceM * frac, bearing, offset)
        const patch = planReroute(q, world, { avoid: [], now: NOW, local })
        if (!patch) return void kinds.none++
        kinds[patch.kind]++
        if (!local) expect(patch.kind).toBe('full')
        const p = patch.route
        const remaining = remainingOf(q)

        // Step budget: what is left to walk is within ±5 % of what is left of the goal.
        const steps = metresToSteps(p.distanceM, q.strideM)
        expect(Math.abs(steps - remaining)).toBeLessThanOrEqual(remaining * TARGET_TOLERANCE + 1)
        expect(p.distanceM).toBeCloseTo(cumulativeDistances(p.points).at(-1)!, 3)

        // Gems: same count and indices, collected ones untouched, uncollected ones in strict order ending at the finish.
        expect(p.checkpoints.map((c) => c.index)).toEqual(route.checkpoints.map((c) => c.index))
        expect(p.checkpoints.slice(0, q.collected)).toEqual(route.checkpoints.slice(0, q.collected))
        const rest = p.checkpoints.slice(q.collected)
        for (let i = 1; i < rest.length; i++) expect(rest[i]!.distanceM).toBeGreaterThan(rest[i - 1]!.distanceM)
        expect(rest[0]!.distanceM).toBeGreaterThan(0)
        expect(rest.at(-1)!.isFinish).toBe(true)
        expect(rest.at(-1)!.distanceM).toBeCloseTo(p.distanceM, 0)

        // The new route starts next to the walker and ends at the finish.
        expect(haversine(p.points[0]!, q.player!)).toBeLessThan(150 + 1)
        expect(haversine(p.points.at(-1)!, route.points.at(-1)!)).toBeLessThan(1)

        if (patch.kind === 'local') {
          // Uncollected gems stay where they were, and the rejoin is not behind the walker.
          rest.forEach((c, i) => expect(c.point).toEqual(route.checkpoints[q.collected + i]!.point))
          // The patch is a short leg plus the old route from some vertex i on. That join vertex lies ahead
          // of the walker and not past the next gem (the leg itself may touch the street behind the walker).
          const old = route.points
          const cumulative = cumulativeDistances(old)
          const nextM = route.checkpoints[q.collected]!.distanceM
          const joins: { i: number; at: number }[] = []
          for (let i = 1; i < old.length; i++) {
            if (cumulative[i]! < q.alongM - 1e-6 || cumulative[i]! > nextM + 1e-6) continue
            const tail = old.slice(i + 1)
            const at = p.points.length - tail.length - 1
            if (at < 0) continue
            if (tail.every((pt, j) => pt.lat === p.points[at + 1 + j]!.lat && pt.lon === p.points[at + 1 + j]!.lon) && haversine(p.points[at]!, old[i]!) <= 8) joins.push({ i, at })
          }
          expect(joins.length, 'a join vertex between the walker and the next gem').toBeGreaterThan(0)
          // P-RR4 (61.8): the patch length is the graph's own edge lengths along the new leg, plus the hop to
          // the old route, plus the kept tail of the old route (three independent length computations agree).
          const { i, at } = joins[0]!
          let legM = 0
          for (let k = 0; k < at; k++) legM += graph.edgeLength(graph.nearestNode(p.points[k]!, false)!.node, graph.nearestNode(p.points[k + 1]!, false)!.node)
          const hop = haversine(p.points[at]!, old[i + 1] ?? p.points[at]!)
          const tailM = (cumulative.at(-1) ?? 0) - (cumulative[i + 1] ?? cumulative.at(-1)!)
          expect(Math.abs(p.distanceM - (legM + hop + tailM))).toBeLessThan(0.05)
        } else {
          // A full replan spreads the uncollected gems evenly over the new route.
          const gaps = rest.map((c, i) => c.distanceM - (i ? rest[i - 1]!.distanceM : 0))
          for (const gap of gaps) expect(Math.abs(gap - p.distanceM / rest.length)).toBeLessThanOrEqual(1e-6 * p.distanceM + 1e-6)
        }
      }),
      { seed: SEED, numRuns: 40 },
    )
    // The property must exercise both reroute kinds, not pass by returning nothing.
    expect(kinds.local).toBeGreaterThan(0)
    expect(kinds.full).toBeGreaterThan(0)
  })

  it('P-RR3: below the minimum remaining steps no reroute is attempted', () => {
    const route = routes[0]!
    fc.assert(
      fc.property(fc.double({ min: 0.97, max: 1, noNaN: true }), (frac) => {
        const q = walkerOff(route, route.distanceM * frac, 0, 40)
        const last: LatLon | undefined = q.player
        expect(last).toBeDefined()
        if (remainingOf(q) < 150) expect(planReroute(q, world, { avoid: [], now: NOW })).toBeUndefined()
      }),
      { seed: SEED, numRuns: 10 },
    )
  })
})
