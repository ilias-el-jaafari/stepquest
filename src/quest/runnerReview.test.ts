// Regression tests for the Nov 2026 quest runner review (spec: .kiro/specs/quest, tasks 64.x).
import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { isOnRoute } from './deviation.ts'
import { isFreshFix } from './fixFreshness.ts'
import { advanceOdometer, effectiveAccuracy, filterFix, UNKNOWN_ACCURACY_M, type FilterState } from './gpsFilter.ts'
import { applyFix, createQuest, DEFAULT_QUEST_CONFIG, type QuestEvent, type QuestState } from './quest.ts'
import { applyReroute, patchFits, type ReroutePatch } from './reroute.ts'
import { prng } from './simulate.ts'
import type { GpsFix, QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }
const fixAt = (p: LatLon, tSec: number, accuracy = 8): GpsFix => ({ lat: p.lat, lon: p.lon, accuracy, timestamp: tSec * 1000 })
const east = (m: number) => destination(origin, 90, m)

/** Straight 1 km route due east, gems at 250, 500, 750 and 1000 m. */
function straight(): QuestRoute {
  const points = Array.from({ length: 11 }, (_, i) => east(i * 100))
  return { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
}
const quest = (route = straight()) => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 't' })

function run(q: QuestState, fixes: GpsFix[]) {
  const events: QuestEvent[] = []
  for (const f of fixes) {
    const r = applyFix(q, f)
    q = r.state
    events.push(...r.events)
  }
  return { q, events }
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand())
}

describe('64.2 filter input hardening', () => {
  it('rejects invalid coordinates as `invalid`, without the weak-signal hint', () => {
    expect(filterFix(undefined, { lat: Number.NaN, lon: 0, accuracy: 5, timestamp: 1 })).toMatchObject({ accepted: false, reason: 'invalid' })
    expect(filterFix(undefined, { lat: 91, lon: 0, accuracy: 5, timestamp: 1 })).toMatchObject({ accepted: false, reason: 'invalid' })
    expect(filterFix(undefined, { lat: 0, lon: 181, accuracy: 5, timestamp: 1 })).toMatchObject({ accepted: false, reason: 'invalid' })
    expect(filterFix(undefined, { lat: 0, lon: 0, accuracy: 5, timestamp: Number.NaN })).toMatchObject({ accepted: false, reason: 'invalid' })
    const r = applyFix(quest(), { lat: Number.NaN, lon: 0, accuracy: 5, timestamp: 1000 })
    expect(r.events).toEqual([{ type: 'rejected', reason: 'invalid' }])
    expect(r.state.weakSince).toBeUndefined()
  })

  it('treats accuracy 0, negative, NaN or missing as unknown (20 m), not as rejected and not as perfect', () => {
    for (const accuracy of [0, -3, Number.NaN, undefined as unknown as number]) {
      expect(effectiveAccuracy(accuracy)).toBe(UNKNOWN_ACCURACY_M)
      const r = filterFix(undefined, { ...fixAt(origin, 1), accuracy })
      expect(r.accepted).toBe(true)
      if (r.accepted) expect(r.accuracy).toBe(UNKNOWN_ACCURACY_M)
    }
  })

  it('does not call a walker on the route "off route" when the accuracy is missing', () => {
    let q = quest()
    const fixes = Array.from({ length: 12 }, (_, i) => ({ ...fixAt(east(20 + i * 10), i * 8), accuracy: Number.NaN }))
    q = run(q, fixes).q
    expect(q.lastFixAt).toBeDefined()
    expect(q.offRoute).toBe(false)
    expect(q.odometer.totalM).toBeGreaterThan(40)
  })

  it('needs three outliers that agree with each other, not just three outliers', () => {
    let state = (filterFix(undefined, fixAt(origin, 0, 8)) as { state: FilterState }).state
    const spots = [destination(origin, 0, 500), destination(origin, 120, 600), destination(origin, 250, 700)]
    for (const [i, spot] of spots.entries()) {
      const r = filterFix(state, fixAt(spot, 2 + i, 8))
      expect(r.accepted).toBe(false)
      state = r.state!
    }
    // The walker is still where they were: a normal fix near the origin is accepted.
    const back = filterFix(state, fixAt(destination(origin, 90, 6), 6, 8))
    expect(back.accepted).toBe(true)
    if (back.accepted) expect(haversine(back.position, origin)).toBeLessThan(10)
  })

  it('counts the accuracy of both readings before calling a jump too fast', () => {
    const first = filterFix(undefined, fixAt(origin, 0, 45)) as { state: FilterState }
    // 60 m in one second: 7 m/s + 45 m (new) = 52 m was "too fast"; with the old reading's 45 m too it is plausible.
    const r = filterFix(first.state, fixAt(destination(origin, 90, 60), 1, 45))
    expect(r.accepted).toBe(true)
  })

  it('does not freeze when the device clock is set back', () => {
    let state = (filterFix(undefined, fixAt(origin, 10_000, 8)) as { state: FilterState }).state
    let accepted = 0
    for (let k = 1; k <= 6; k++) {
      const r = filterFix(state, fixAt(origin, 10_000 - 300 + k, 8))
      state = r.state!
      if (r.accepted) accepted++
    }
    expect(accepted).toBeGreaterThanOrEqual(3)
  })

  it('still ignores a single out-of-order or duplicate fix', () => {
    const first = filterFix(undefined, fixAt(origin, 100, 8)) as { state: FilterState }
    expect(filterFix(first.state, fixAt(origin, 100, 8))).toMatchObject({ accepted: false, reason: 'stale' })
    expect(filterFix(first.state, fixAt(origin, 99, 8))).toMatchObject({ accepted: false, reason: 'stale' })
  })
})

describe('64.2 freshness of browser fixes', () => {
  const now = 1_000_000
  it('drops a cached fix after the page was in the background, and one from the future', () => {
    expect(isFreshFix(fixAt(origin, now / 1000 - 5), now)).toBe(true)
    expect(isFreshFix(fixAt(origin, now / 1000 - 31), now)).toBe(false)
    expect(isFreshFix(fixAt(origin, now / 1000 + 30), now)).toBe(true)
    expect(isFreshFix(fixAt(origin, now / 1000 + 61), now)).toBe(false)
  })
})

describe('64.3 odometer', () => {
  it('does not count steps while standing still with realistic GPS noise (10 minutes)', () => {
    for (const [sigma, accuracy] of [
      [3, 5],
      [5, 8],
    ] as const) {
      let q = quest()
      const rand = prng(11)
      for (let t = 1; t <= 600; t++) {
        const p = destination(destination(east(300), 90, gaussian(rand) * sigma), 0, gaussian(rand) * sigma)
        q = applyFix(q, fixAt(p, t, accuracy)).state
      }
      expect(q.odometer.totalM).toBeLessThan(10)
    }
  })

  it('still counts real walking within 3 % (1.4 m/s, noise 5 m)', () => {
    let q = quest()
    const rand = prng(5)
    for (let t = 1; t <= 600; t++) {
      const p = destination(destination(east(1.4 * t), 0, gaussian(rand) * 5), 90, gaussian(rand) * 5)
      q = applyFix(q, fixAt(p, t, 8)).state
    }
    expect(q.odometer.totalM).toBeGreaterThan(840 * 0.97 - 30)
    expect(q.odometer.totalM).toBeLessThan(840 * 1.03 + 30)
  })

  it('adds at most the allowed distance when a jump is accepted after agreeing outliers', () => {
    let q = quest()
    q = run(q, [fixAt(east(100), 0, 6), fixAt(east(110), 8, 6)]).q
    const before = q.odometer.totalM
    // The same far position three times: accepted at the third (350 m away after 3 s).
    q = run(q, [fixAt(east(460), 9, 6), fixAt(east(461), 10, 6), fixAt(east(462), 11, 6)]).q
    expect(q.odometer.totalM - before).toBeLessThanOrEqual(DEFAULT_QUEST_CONFIG.filter.maxSpeedMps * 3 + 6 + 1)
  })

  it('caps the distance added for one fix', () => {
    const odo = advanceOdometer({ anchor: origin, totalM: 10 }, east(300), 6, 20)
    expect(odo.totalM).toBe(30)
    expect(haversine(odo.anchor!, east(300))).toBeLessThan(0.01)
  })
})

describe('64.4 gems', () => {
  it('collects gems passed during a long gap (page in the background for 10 minutes)', () => {
    let q = quest()
    q = run(q, [fixAt(east(100), 0, 6), fixAt(east(110), 8, 6)]).q
    const r = run(q, [fixAt(east(800), 8 + 600, 6)])
    expect(r.events.filter((e) => e.type === 'collected').map((e) => (e as { index: number }).index)).toEqual([1, 2, 3])
    expect(r.q.collected).toBe(3)
  })

  it('does not collect a gem for a teleport (a position accepted after agreeing outliers)', () => {
    let q = quest()
    q = run(q, [fixAt(east(100), 0, 6), fixAt(east(110), 8, 6)]).q
    const r = run(q, [fixAt(east(450), 9, 6), fixAt(east(451), 10, 6), fixAt(east(452), 11, 6)])
    expect(r.q.collected).toBe(0)
    expect(r.events.some((e) => e.type === 'collected')).toBe(false)
  })

  it('collects two close gems in order from one fix, once each', () => {
    const points = Array.from({ length: 11 }, (_, i) => east(i * 100))
    const route: QuestRoute = {
      ...straight(),
      checkpoints: [
        { index: 1, point: east(300), distanceM: 300, isFinish: false },
        { index: 2, point: east(310), distanceM: 310, isFinish: false },
        { index: 3, point: points[10]!, distanceM: 1000, isFinish: true },
      ],
    }
    let q = quest(route)
    q = run(q, [fixAt(east(295), 0, 6)]).q
    expect(q.collected).toBe(2)
    const again = run(q, [fixAt(east(305), 8, 6), fixAt(east(306), 16, 6)])
    expect(again.events.filter((e) => e.type === 'collected')).toEqual([])
    expect(again.q.collected).toBe(2)
  })
})

describe('64.5 off-route', () => {
  it('needs 70 % of the threshold to be on the route again', () => {
    expect(isOnRoute(39, 40, false)).toBe(true)
    expect(isOnRoute(41, 40, false)).toBe(false)
    expect(isOnRoute(35, 40, true)).toBe(false)
    expect(isOnRoute(27, 40, true)).toBe(true)
    expect(DEFAULT_QUEST_CONFIG.returnFactor).toBe(0.7)
  })

  it('does not clear a deviation for one fix just inside the threshold', () => {
    let q = quest()
    q = run(q, [fixAt(east(100), 0, 5), fixAt(east(110), 8, 5)]).q
    const north = (m: number, along: number) => destination(east(along), 0, m)
    q = run(q, [fixAt(north(60, 120), 16, 5), fixAt(north(62, 125), 24, 5), fixAt(north(63, 130), 32, 5)]).q
    expect(q.offRoute).toBe(true)
    q = run(q, [fixAt(north(34, 135), 40, 5)]).q
    expect(q.offRoute).toBe(true)
    expect(q.offStart).toBeDefined()
  })

  it('says backOnRoute when the "left the route" message ends because the walker heads for the gem again', () => {
    let q = quest()
    const along = (from: LatLon, bearing: number, metres: number, t0: number): GpsFix[] => {
      const out: GpsFix[] = []
      let p = from
      for (let d = 10; d <= metres; d += 10) {
        p = destination(p, bearing, 10)
        out.push(fixAt(p, t0 + (d / 10) * 8, 6))
      }
      return out
    }
    // 100 m along, a block south, then west (away from the gem): the message shows.
    let fixes = [...along(origin, 90, 100, 0)]
    const corner = east(100)
    fixes = [...fixes, ...along(corner, 180, 60, 100), ...along(destination(corner, 180, 60), 270, 120, 200)]
    q = run(q, fixes).q
    expect(q.lost).toBe(true)
    const back = run(q, along(q.player!, 90, 260, 400))
    expect(back.q.lost).toBe(false)
    expect(back.events.some((e) => e.type === 'backOnRoute')).toBe(true)
  })
})

describe('64.6 reroute patch binding', () => {
  function offQuest(): QuestState {
    const base = quest()
    return { ...base, rerouted: 0, collected: 1, offRoute: true, lost: false, player: destination(east(300), 0, 80), alongM: 300 }
  }
  const patchFor = (q: QuestState, over: Partial<ReroutePatch> = {}): ReroutePatch => ({
    questId: q.id,
    base: q.rerouted ?? 0,
    collected: q.collected,
    from: q.player!,
    kind: 'local',
    route: q.route,
    walked: [],
    ...over,
  })

  it('applies a patch computed for this state', () => {
    const q = offQuest()
    expect(patchFits(q, patchFor(q))).toBe(true)
    expect(applyReroute(q, patchFor(q))?.rerouted).toBe(1)
  })
  it('refuses a patch when a gem was collected meanwhile', () => {
    const q = offQuest()
    expect(applyReroute({ ...q, collected: 2 }, patchFor(q))).toBeUndefined()
  })
  it('refuses a patch when the walker is back on the route', () => {
    const q = offQuest()
    expect(applyReroute({ ...q, offRoute: false }, patchFor(q))).toBeUndefined()
  })
  it('refuses a patch computed for a place the walker has left far behind', () => {
    const q = offQuest()
    expect(applyReroute({ ...q, player: destination(q.player!, 90, 200) }, patchFor(q))).toBeUndefined()
    expect(applyReroute({ ...q, player: destination(q.player!, 90, 30) }, patchFor(q))).toBeDefined()
  })
})
