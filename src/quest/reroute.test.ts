import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { metresToSteps, TARGET_TOLERANCE } from '../geo/steps.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planRoute } from '../routing/planner.ts'
import { nearestStreet, safetyContext } from '../routing/safety.ts'
import { applyFix, createQuest, DEFAULT_QUEST_CONFIG, judgeDeviation, type QuestEvent, type QuestState } from './quest.ts'
import { rerouteQuest } from './reroute.ts'
import type { GpsFix, QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }

/** Straight 1 km due east, 4 checkpoints (250 m apart). */
function straight(): QuestRoute {
  const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
  return { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
}

/** A walk as GPS fixes: legs of [bearing, metres], one fix every 10 m (8 s), optional jitter. */
function walk(from: LatLon, legs: [number, number][], t0 = 0, jitter = 0): GpsFix[] {
  const out: GpsFix[] = []
  let p = from
  let t = t0
  let k = 0
  for (const [bearing, metres] of legs) {
    for (let d = 10; d <= metres; d += 10) {
      p = destination(p, bearing, 10)
      t += 8000
      // Deterministic jitter, alternating sides.
      const j = jitter ? destination(p, (k++ * 137) % 360, jitter * ((k % 3) / 2)) : p
      out.push({ lat: j.lat, lon: j.lon, accuracy: 6, timestamp: t })
    }
  }
  return out
}

function run(q: QuestState, fixes: GpsFix[]) {
  const events: QuestEvent[] = []
  let lostAt: number | undefined
  fixes.forEach((f, i) => {
    const r = applyFix(q, f)
    q = r.state
    events.push(...r.events)
    if (q.lost && lostAt === undefined) lostAt = i
  })
  return { q, events, lostAt }
}

const quest = (route = straight()) => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 't' })

describe('judging a deviation', () => {
  const off = { from: origin, point: origin, odoM: 100, goalM: 300 }
  const goal = destination(origin, 90, 300)
  it('waits until the walker has really moved off the line', () => {
    expect(judgeDeviation(off, destination(origin, 270, 15), 115, goal)).toBe('wait')
  })
  it('sees a parallel street towards the goal as heading for it', () => {
    expect(judgeDeviation(off, destination(destination(origin, 0, 30), 90, 40), 170, goal)).toBe('toward')
    // 80° off the goal bearing still counts.
    expect(judgeDeviation(off, destination(origin, 10, 40), 140, goal)).toBe('toward')
  })
  it('decides after 20 m of real walking, not 30', () => {
    expect(DEFAULT_QUEST_CONFIG.decideM).toBe(20)
    expect(judgeDeviation(off, destination(destination(origin, 0, 15), 90, 10), 117, goal)).toBe('wait')
    expect(judgeDeviation(off, destination(destination(origin, 0, 15), 90, 10), 121, goal)).toBe('toward')
  })
  it('flags walking clearly away only after a sustained distance', () => {
    const back = destination(origin, 270, 40)
    expect(judgeDeviation(off, back, 140, goal)).toBe('wait')
    expect(judgeDeviation(off, destination(origin, 270, 70), 170, goal)).toBe('away')
  })
})

describe('off-route while walking (simulated tracks)', () => {
  it('ignores GPS noise along the route', () => {
    const { q, events } = run(quest(), walk(origin, [[90, 200]], 0, 18))
    expect(events.filter((e) => e.type === 'offRoute' || e.type === 'reroute')).toEqual([])
    expect(q.lost).toBe(false)
  })

  it('starts rerouting soon after a genuine deviation: within 100 m of leaving the line', () => {
    // 100 m along, then straight north across the neighbouring blocks (towards nothing in particular, not away from the goal).
    const fixes = walk(origin, [[90, 100], [0, 200]])
    let q = quest()
    let at: number | undefined
    fixes.forEach((f, i) => {
      const r = applyFix(q, f)
      q = r.state
      if (at === undefined && r.events.some((e) => e.type === 'reroute')) at = i
    })
    expect(at).toBeDefined()
    // 10 fixes on the line, then 10 m per fix: the reroute comes within 10 fixes (100 m) of the corner.
    // (The odometer counts in chunks of twice the accuracy, so the 20 m decision can come one fix later.)
    expect(at! - 10).toBeLessThanOrEqual(10)
  })

  it('does not reroute for GPS jitter that jumps off the line for one fix', () => {
    const fixes = walk(origin, [[90, 300]])
    fixes[14] = { ...fixes[14]!, lat: fixes[14]!.lat + 90 / 111_320 }
    const { events, q } = run(quest(), fixes)
    expect(events.filter((e) => e.type === 'reroute' || e.type === 'offRoute')).toEqual([])
    expect(q.offRoute).toBe(false)
  })

  it('asks for a quiet reroute on a parallel street towards the next checkpoint, with no message', () => {
    // 100 m along, then one block north and on east along the parallel street.
    const { q, events } = run(quest(), walk(origin, [[90, 100], [0, 60], [90, 150]]))
    expect(events.some((e) => e.type === 'reroute')).toBe(true)
    expect(events.some((e) => e.type === 'offRoute')).toBe(false)
    expect(q.lost).toBe(false)
    // One request, retried only after more walking.
    expect(events.filter((e) => e.type === 'reroute').length).toBeLessThanOrEqual(3)
  })

  it('shows "you left the route" only when walking clearly away for a while', () => {
    // 100 m along, a block south, then back west away from the next checkpoint.
    const { q, events, lostAt } = run(quest(), walk(origin, [[90, 100], [180, 60], [270, 120]]))
    expect(events.some((e) => e.type === 'offRoute')).toBe(true)
    expect(q.lost).toBe(true)
    // Not before at least 60 m off the line (10 fixes on the route + 6 south + some west).
    expect(lostAt).toBeGreaterThan(16)
    // Back on the route: the message clears.
    const back = run(q, walk({ lat: q.player!.lat, lon: q.player!.lon }, [[0, 60], [90, 120]], 400_000))
    expect(back.events.some((e) => e.type === 'backOnRoute')).toBe(true)
    expect(back.q.lost).toBe(false)
  })
})

describe('rerouting on the demo map', () => {
  const data = loadDemoOsm()
  const graph = new WalkGraph(data)
  const ctx = safetyContext(graph, data)
  const world = { graph, ctx, data, bbox: DEMO_AREA.bbox }
  const planned = planRoute(graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 6000, strideM: 0.75, seed: 3 }, DEMO_AREA.bbox)
  if (!planned.ok) throw new Error('route')
  const r = planned.route
  const route: QuestRoute = { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }

  it('replans the rest from the current position within ±5 % of the remaining steps, keeping collected gems', () => {
    // Walk the route for 1.2 km (collecting the first gem), then leave it.
    let q = quest(route)
    const along: LatLon[] = []
    let acc = 0
    for (let i = 1; i < route.points.length && acc < 1200; i++) {
      const a = route.points[i - 1]!
      const b = route.points[i]!
      const seg = haversine(a, b)
      for (let d = 10; d < seg; d += 10) along.push({ lat: a.lat + ((b.lat - a.lat) * d) / seg, lon: a.lon + ((b.lon - a.lon) * d) / seg })
      along.push(b)
      acc += seg
    }
    along.forEach((p, i) => (q = applyFix(q, { ...p, accuracy: 5, timestamp: (i + 1) * 8000 }).state))
    expect(q.collected).toBeGreaterThanOrEqual(1)
    const leftFrom = q.player!
    // A side step of 80 m onto another street (as the GPS would see it).
    const side = walk(leftFrom, [[0, 40], [90, 40]], along.length * 8000 + 8000)
    for (const f of side) q = applyFix(q, f).state
    expect(q.offRoute).toBe(true)
    const next = rerouteQuest(q, world, { avoid: [], now: Date.UTC(2026, 10, 22, 12) })
    expect(next).toBeDefined()
    const remaining = route.targetSteps - metresToSteps(q.odometer.totalM, 0.75)
    const newSteps = metresToSteps(next!.route.distanceM, 0.75)
    expect(Math.abs(newSteps - remaining)).toBeLessThanOrEqual(remaining * TARGET_TOLERANCE + 1)
    expect(haversine(next!.route.points[0]!, q.player!)).toBeLessThan(150)
    expect(next!.collected).toBe(q.collected)
    expect(next!.route.checkpoints).toHaveLength(route.checkpoints.length)
    expect(next!.route.checkpoints.map((c) => c.index)).toEqual(route.checkpoints.map((c) => c.index))
    expect(next!.route.checkpoints.at(-1)!.isFinish).toBe(true)
    expect(haversine(next!.route.checkpoints.at(-1)!.point, route.checkpoints.at(-1)!.point)).toBeLessThan(150)
    expect(next!.alongM).toBe(0)
    expect(next!.offRoute || next!.lost).toBe(false)
    expect(next!.rerouted).toBe(1)
    // The walked stretch of the old route stays, to be drawn as walked footprints.
    const kept = next!.walkedBefore ?? []
    expect(kept).toHaveLength(1)
    expect(kept[0]![0]).toEqual(route.points[0])
    const keptM = kept[0]!.slice(1).reduce((m, p, i) => m + haversine(kept[0]![i]!, p), 0)
    expect(Math.abs(keptM - q.alongM)).toBeLessThan(1)
    // A second reroute adds to it rather than replacing it.
    const again = rerouteQuest({ ...next!, alongM: 50 }, world, { avoid: [], now: Date.UTC(2026, 10, 22, 12) })
    if (again) expect(again.walkedBefore).toHaveLength(2)
    // The street they left is avoided when another way fits.
    const left = nearestStreet(data, q.offStart!.from)
    if (left) {
      const usesLeft = next!.route.points.slice(3).filter((p) => nearestStreet(data, p, 8) === left).length
      expect(usesLeft).toBeLessThan(next!.route.points.length * 0.2)
    }
  })

  it('gives up cleanly when too few steps are left', () => {
    const q = { ...quest(route), player: DEMO_AREA.defaultStart, odometer: { anchor: undefined, totalM: route.distanceM } }
    expect(rerouteQuest(q, world, { avoid: [], now: 0 })).toBeUndefined()
  })
})
