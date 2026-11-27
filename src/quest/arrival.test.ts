import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination, type LatLon } from '../geo/geo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { ARRIVAL_MIN_WALKED, ARRIVAL_PROGRESS, canCollect } from './collect.ts'
import { applyFix, createQuest, trackFor, type QuestState } from './quest.ts'
import { pointAt } from './testWalk.testutil.ts'
import type { QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }

/** A square loop of `sideM` per side: start = finish. */
function loopRoute(sideM: number, gems: number): QuestRoute {
  const a = origin
  const b = destination(a, 90, sideM)
  const c = destination(b, 0, sideM)
  const d = destination(a, 0, sideM)
  const points: LatLon[] = [a, b, c, d, a]
  return { mode: 'loop', points, distanceM: sideM * 4, steps: Math.round((sideM * 4) / 0.75), targetSteps: Math.round((sideM * 4) / 0.75), checkpoints: placeCheckpoints(points, gems) }
}

const newQuest = (route: QuestRoute): QuestState => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0, id: 'arrival' })

/** Walk the route in steps of `stepM`, up to `toM` metres, one fix each 10 s. */
function walk(route: QuestRoute, toM: number, stepM = 10) {
  let q = newQuest(route)
  const track = trackFor(route)
  const events: string[] = []
  let t = 0
  for (let d = 0; d <= toM + 1e-9; d += stepM) {
    const r = applyFix(q, { ...pointAt(track.points, track.cumulative, Math.min(d, track.total)), accuracy: 5, timestamp: (t += 10_000) })
    q = r.state
    events.push(...r.events.map((e) => e.type))
  }
  return { q, events }
}

describe('arrival rule (requirement 6h)', () => {
  it('canCollect: the finish needs progress and walked distance, other gems need progress near them', () => {
    const fin = { distanceM: 1000, isFinish: true }
    expect(canCollect(fin, 0, 0, 1000, 22)).toBe(false)
    expect(canCollect(fin, 1000, 0, 1000, 22)).toBe(false)
    expect(canCollect(fin, 0, 1000, 1000, 22)).toBe(false)
    expect(canCollect(fin, ARRIVAL_PROGRESS * 1000, ARRIVAL_MIN_WALKED * 1000, 1000, 22)).toBe(true)
    const gem = { distanceM: 500, isFinish: false }
    expect(canCollect(gem, 0, 0, 1000, 22)).toBe(false)
    expect(canCollect(gem, 460, 0, 1000, 22)).toBe(true)
  })

  it('a one-gem loop is not finished by the first fix at the start (0 steps)', () => {
    const route = loopRoute(150, 1)
    const { q, events } = walk(route, 0)
    expect(q.finishedAt).toBeUndefined()
    expect(q.collected).toBe(0)
    expect(events).not.toContain('finished')
  })

  it('a one-gem loop is finished after the whole loop, not before 90 %', () => {
    const route = loopRoute(150, 1)
    expect(walk(route, route.distanceM * 0.85).q.finishedAt).toBeUndefined()
    expect(walk(route, route.distanceM).q.finishedAt).toBeDefined()
  })

  it('a gem near the start of a loop is not collected at the start', () => {
    // Four gems on a 600 m loop: gem 4 (the finish) lies at the start.
    const route = loopRoute(150, 4)
    const { q } = walk(route, 20)
    expect(q.collected).toBe(0)
    expect(walk(route, route.distanceM).q.collected).toBe(4)
  })

  it('an A → B walk whose finish is near the start is not finished at the start', () => {
    const points = [origin, destination(origin, 0, 400), destination(origin, 90, 15)]
    const route: QuestRoute = { mode: 'oneway', points, distanceM: 815, steps: 1086, targetSteps: 1086, checkpoints: placeCheckpoints(points, 1) }
    expect(walk(route, 0).q.finishedAt).toBeUndefined()
    expect(walk(route, route.distanceM).q.finishedAt).toBeDefined()
  })

  it('property: for any loop and any monotonic progress sequence, no arrival below the threshold, arrival once all is walked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 400 }),
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 80 }),
        (sideM, gems, increments) => {
          const route = loopRoute(sideM, gems)
          const track = trackFor(route)
          let q = newQuest(route)
          let along = 0
          let t = 0
          const feed = (d: number) => {
            q = applyFix(q, { ...pointAt(track.points, track.cumulative, d), accuracy: 5, timestamp: (t += 10_000) }).state
          }
          feed(0)
          expect(q.finishedAt).toBeUndefined()
          for (const inc of increments) {
            along = Math.min(track.total, along + inc)
            feed(along)
            if (along < ARRIVAL_PROGRESS * track.total) expect(q.finishedAt).toBeUndefined()
          }
          // Then the rest of the loop, 10 m at a time.
          for (let d = along; d < track.total; d += 10) feed(d)
          feed(track.total)
          expect(q.finishedAt).toBeDefined()
        },
      ),
      { numRuns: 60 },
    )
  })
})
