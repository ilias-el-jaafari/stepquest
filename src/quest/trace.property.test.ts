// Property tests on random noisy GPS traces (spec 6b, task 64.12).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination } from '../geo/geo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { applyFix, createQuest, type QuestEvent, type QuestState } from './quest.ts'
import { prng } from './simulate.ts'
import type { GpsFix, QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }
const east = (m: number) => destination(origin, 90, m)
const points = Array.from({ length: 11 }, (_, i) => east(i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 5) }
const fresh = (): QuestState => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 'prop' })

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r())

type Params = { seed: number; speed: number; sigma: number; seconds: number; pauseEvery: number; glitchEvery: number; dupEvery: number; badAccuracy: boolean; walkTo: number }
const params = fc.record({
  seed: fc.integer({ min: 1, max: 1e6 }),
  speed: fc.double({ min: 0.8, max: 2, noNaN: true }),
  sigma: fc.double({ min: 0.5, max: 5, noNaN: true }),
  seconds: fc.integer({ min: 60, max: 900 }),
  pauseEvery: fc.constantFrom(0, 40, 90),
  glitchEvery: fc.constantFrom(0, 25, 60),
  dupEvery: fc.constantFrom(0, 7, 20),
  badAccuracy: fc.boolean(),
  walkTo: fc.integer({ min: 100, max: 1000 }),
})

/** One fix per second along the route (stopping at `walkTo`), with pauses, noise, glitches and duplicates. */
function trace(p: Params): { fixes: GpsFix[]; trueM: number } {
  const r = prng(p.seed)
  const fixes: GpsFix[] = []
  let along = 0
  let walked = 0
  let pause = 0
  for (let t = 1; t <= p.seconds; t++) {
    if (p.pauseEvery && t % p.pauseEvery === 0) pause = 20
    if (pause > 0) pause--
    else if (along < p.walkTo) {
      const step = Math.min(p.speed, p.walkTo - along)
      along += step
      walked += step
    }
    let pos = destination(destination(east(along), 90, gauss(r) * p.sigma), 0, gauss(r) * p.sigma)
    if (p.glitchEvery && t % p.glitchEvery === 0) pos = destination(pos, r() * 360, 150 + r() * 150)
    const accuracy = p.badAccuracy && t % 3 === 0 ? [0, Number.NaN][t % 2]! : Math.max(5, Math.round(p.sigma * 1.6))
    const fix = { ...pos, accuracy, timestamp: t * 1000 }
    fixes.push(fix)
    if (p.dupEvery && t % p.dupEvery === 0) fixes.push(fix)
  }
  return { fixes, trueM: walked }
}

function replay(fixes: GpsFix[], check?: (before: QuestState, after: QuestState, events: QuestEvent[]) => void) {
  let q = fresh()
  const events: QuestEvent[] = []
  for (const f of fixes) {
    const r = applyFix(q, f)
    check?.(q, r.state, r.events)
    q = r.state
    events.push(...r.events)
  }
  return { q, events }
}

describe('random GPS traces (64.12)', () => {
  it('the odometer never decreases and never runs ahead of the walk', () => {
    fc.assert(
      fc.property(params, (p) => {
        const { fixes, trueM } = trace(p)
        const { q } = replay(fixes, (before, after) => expect(after.odometer.totalM).toBeGreaterThanOrEqual(before.odometer.totalM))
        // Glitches can only be counted when three agree, which these random ones do not, so no big inflation.
        expect(q.odometer.totalM).toBeLessThanOrEqual(trueM * 1.15 + 40)
      }),
      { numRuns: 150 },
    )
  })

  it('does not count distance while standing still within the noise', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.double({ min: 0.5, max: 4, noNaN: true }), fc.integer({ min: 0, max: 900 }), (seed, sigma, at) => {
        const { fixes } = trace({ seed, speed: 0, sigma, seconds: 600, pauseEvery: 0, glitchEvery: 0, dupEvery: 5, badAccuracy: false, walkTo: at })
        // At most one threshold-sized chunk (the first anchor is a raw fix, so the smoothed position can settle one
        // chunk away from it), never a drift that grows with time: 10 minutes of standing stay under 15 m.
        expect(replay(fixes).q.odometer.totalM).toBeLessThan(15)
      }),
      { numRuns: 80 },
    )
  })

  it('collects gems once, in route order, and finishes only after the flag', () => {
    fc.assert(
      fc.property(params, (p) => {
        const { fixes } = trace(p)
        let finishedSeen = 0
        const { q, events } = replay(fixes, (before, after, ev) => {
          expect(after.collected).toBeGreaterThanOrEqual(before.collected)
          expect(after.collected - before.collected).toBe(ev.filter((e) => e.type === 'collected').length)
          if (ev.some((e) => e.type === 'finished')) {
            finishedSeen++
            expect(after.collected).toBe(route.checkpoints.length)
            expect(after.finishedAt).toBeDefined()
          }
          if (after.finishedAt === undefined) expect(after.collected).toBeLessThan(route.checkpoints.length)
        })
        const order = events.filter((e): e is Extract<QuestEvent, { type: 'collected' }> => e.type === 'collected').map((e) => e.index)
        expect(order).toEqual(route.checkpoints.slice(0, order.length).map((c) => c.index))
        expect(finishedSeen).toBe(q.finishedAt === undefined ? 0 : 1)
        if (q.finishedAt !== undefined) expect(order.at(-1)).toBe(route.checkpoints.at(-1)!.index)
      }),
      { numRuns: 150 },
    )
  })

  it('does not collect a gem the walker never came near', () => {
    fc.assert(
      fc.property(params, (p) => {
        const { fixes } = trace({ ...p, glitchEvery: 0 })
        const { q } = replay(fixes)
        const reached = Math.max(0, ...fixes.map((f) => (f.lon - origin.lon) / (east(1).lon - origin.lon)))
        // Every collected gem lies within pickup range of the furthest noisy position seen.
        for (const c of route.checkpoints.slice(0, q.collected)) expect(c.distanceM).toBeLessThanOrEqual(reached + 40)
      }),
      { numRuns: 100 },
    )
  })

  it('a clean walk of the whole route finishes with every gem in order', () => {
    const { fixes } = trace({ seed: 3, speed: 1.4, sigma: 3, seconds: 900, pauseEvery: 0, glitchEvery: 0, dupEvery: 0, badAccuracy: false, walkTo: 1000 })
    const { q, events } = replay(fixes)
    expect(q.finishedAt).toBeDefined()
    expect(events.filter((e) => e.type === 'collected')).toHaveLength(route.checkpoints.length)
  })
})
