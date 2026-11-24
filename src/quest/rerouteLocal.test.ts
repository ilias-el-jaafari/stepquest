import { describe, expect, it } from 'vitest'
import { haversine } from '../geo/geo.ts'
import { metresToSteps, TARGET_TOLERANCE } from '../geo/steps.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planRoute } from '../routing/planner.ts'
import { safetyContext } from '../routing/safety.ts'
import { applyReroute, patchFits, planReroute, rerouteQuest } from './reroute.ts'
import { makeTrack, snapToRoute } from './snap.ts'
import { offRouteQuest } from './testWalk.ts'
import type { QuestRoute } from './types.ts'

const NOW = Date.UTC(2026, 10, 22, 12)
const data = loadDemoOsm()
const graph = new WalkGraph(data)
const ctx = safetyContext(graph, data)
const world = { graph, ctx, data, bbox: DEMO_AREA.bbox }
const planned = planRoute(graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 10_000, strideM: 0.75, seed: 1 }, DEMO_AREA.bbox)
if (!planned.ok) throw new Error('route')
const r = planned.route
const route: QuestRoute = { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }
const remainingOf = (q: { odometer: { totalM: number } }) => route.targetSteps - metresToSteps(q.odometer.totalM, 0.75)

describe('local reconnect', () => {
  // On this loop a deviation at 600 m, 3500 m and 5000 m reconnects locally; the one at 1500 m does not fit.
  const walks = [600, 3500, 5000]
  const cases = walks.map((m) => ({ m, q: offRouteQuest(route, m) })).filter((c) => c.q.offRoute)

  it('has deviations to test', () => {
    expect(cases.length).toBeGreaterThanOrEqual(2)
  })

  it('reconnects to the planned route with the remaining step budget within ±5 %', () => {
    const kinds = cases.map(({ q }) => planReroute(q, world, { avoid: [], now: NOW })?.kind)
    expect(kinds).toContain('local')
    for (const { q } of cases) {
      const patch = planReroute(q, world, { avoid: [], now: NOW })
      if (patch?.kind !== 'local') continue
      const remaining = remainingOf(q)
      const steps = metresToSteps(patch.route.distanceM, 0.75)
      expect(Math.abs(steps - remaining)).toBeLessThanOrEqual(remaining * TARGET_TOLERANCE + 1)
      // Starts next to the walker and ends where the planned route ended.
      expect(haversine(patch.route.points[0]!, q.player!)).toBeLessThan(150)
      expect(haversine(patch.route.points.at(-1)!, route.points.at(-1)!)).toBeLessThan(1)
    }
  })

  it('keeps every uncollected gem at its place and in order, and the collected ones', () => {
    for (const { q } of cases) {
      const patch = planReroute(q, world, { avoid: [], now: NOW })
      if (patch?.kind !== 'local') continue
      const cps = patch.route.checkpoints
      expect(cps.map((c) => c.index)).toEqual(route.checkpoints.map((c) => c.index))
      cps.forEach((c, i) => expect(c.point).toEqual(route.checkpoints[i]!.point))
      const rest = cps.slice(q.collected)
      for (let i = 1; i < rest.length; i++) expect(rest[i]!.distanceM).toBeGreaterThan(rest[i - 1]!.distanceM)
      // Each uncollected gem sits on the new route, at the stated distance from its start.
      expect(rest.at(-1)!.distanceM).toBeCloseTo(patch.route.distanceM, 0)
      expect(rest[0]!.distanceM).toBeGreaterThan(0)
      expect(cps.slice(0, q.collected)).toEqual(route.checkpoints.slice(0, q.collected))
    }
  })

  it('never joins past the next gem', () => {
    for (const { q } of cases) {
      const patch = planReroute(q, world, { avoid: [], now: NOW })
      if (patch?.kind !== 'local') continue
      const next = route.checkpoints[q.collected]!
      expect(snapToRoute(makeTrack(patch.route.points), next.point).offsetM).toBeLessThan(1)
    }
  })

  it('is much cheaper than a full replan on the same deviation', () => {
    const { q } = cases[0]!
    const time = (local: boolean) => {
      const t = performance.now()
      for (let i = 0; i < 3; i++) planReroute(q, world, { avoid: [], now: NOW, local })
      return performance.now() - t
    }
    time(true)
    expect(time(true)).toBeLessThan(time(false))
  })

  it('falls back to a full replan when the reconnection would break the budget', () => {
    const q = offRouteQuest(route, 1500)
    expect(q.offRoute).toBe(true)
    const patch = planReroute(q, world, { avoid: [], now: NOW })
    expect(patch?.kind).toBe('full')
    const remaining = remainingOf(q)
    expect(Math.abs(metresToSteps(patch!.route.distanceM, 0.75) - remaining)).toBeLessThanOrEqual(remaining * TARGET_TOLERANCE + 1)
  })
})

describe('applying a patch', () => {
  const q = offRouteQuest(route, 600)
  const patch = planReroute(q, world, { avoid: [], now: NOW })!

  it('replaces the route, resets the off-route state and keeps the walked footprints', () => {
    const next = applyReroute(q, patch)!
    expect(next.route).toBe(patch.route)
    expect(next.alongM).toBe(0)
    expect(next.offRoute).toBe(false)
    expect(next.rerouted).toBe(1)
    expect(next.walkedBefore).toHaveLength(1)
    expect(next.odometer).toBe(q.odometer)
  })

  it('merges into a newer state of the same quest without touching what moved on', () => {
    const newer = { ...q, odometer: { ...q.odometer, totalM: q.odometer.totalM + 5 }, accuracy: 3 }
    const next = applyReroute(newer, patch)!
    expect(next.odometer.totalM).toBe(q.odometer.totalM + 5)
    expect(next.accuracy).toBe(3)
  })

  it('ignores a stale patch: another reroute applied, other quest, finished or ended', () => {
    expect(applyReroute({ ...q, rerouted: 1 }, patch)).toBeUndefined()
    expect(applyReroute({ ...q, id: 'other' }, patch)).toBeUndefined()
    expect(applyReroute({ ...q, finishedAt: 1 }, patch)).toBeUndefined()
    expect(applyReroute(undefined, patch)).toBeUndefined()
    expect(patchFits(q, patch)).toBe(true)
  })

  it('is what the synchronous wrapper returns', () => {
    expect(rerouteQuest(q, world, { avoid: [], now: NOW })?.route.points).toEqual(applyReroute(q, patch)!.route.points)
  })
})
