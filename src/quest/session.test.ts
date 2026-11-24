import { describe, expect, it } from 'vitest'
import { destination } from '../geo/geo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { createQuest, type QuestState } from './quest.ts'
import type { ReroutePatch } from './reroute.ts'
import { QuestSession } from './session.ts'
import { QUEST_STORAGE_KEY } from './storage.ts'
import type { GpsFix, QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }
const east = (m: number) => destination(origin, 90, m)
const points = Array.from({ length: 11 }, (_, i) => east(i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
const fix = (m: number, tSec: number): GpsFix => ({ ...east(m), accuracy: 6, timestamp: tSec * 1000 })

function setup(over: { simulated?: boolean; now?: number } = {}) {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  const credits: { steps: number; at: number }[] = []
  let clock = over.now ?? 0
  const q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: over.simulated ?? false, now: 0, id: 's' })
  const session = new QuestSession(q, { store, credit: (steps, at) => credits.push({ steps, at }), now: () => clock })
  return { session, store, m, credits, tick: (ms: number) => (clock += ms) }
}

/** Walk `n` fixes of 10 m, every 8 s of device time. */
function walk(s: QuestSession, from: number, n: number, t0 = 0) {
  for (let i = 1; i <= n; i++) s.handleFix(fix(from + i * 10, t0 + i * 8))
}

describe('QuestSession (64.11)', () => {
  it('saves at once on a pickup, otherwise at most once a second', () => {
    const { session, m, tick } = setup()
    const writes: string[] = []
    const first = session.handleFix(fix(10, 0))
    expect(first.saved).toBe(true) // first save
    writes.push(m.get(QUEST_STORAGE_KEY)!)
    tick(300)
    expect(session.handleFix(fix(20, 8)).saved).toBe(false)
    tick(800)
    expect(session.handleFix(fix(30, 16)).saved).toBe(true)
    // A pickup is saved without waiting.
    for (let m = 40, t = 24; m <= 220; m += 10, t += 8) session.handleFix(fix(m, t))
    tick(10)
    // Keep walking until the first gem is picked up (the smoother lags a few metres behind).
    let pick = session.handleFix(fix(230, 24 + 19 * 8))
    for (let m = 240, t = 24 + 20 * 8; !pick.events.some((e) => e.type === 'collected') && m < 400; m += 10, t += 8) pick = session.handleFix(fix(m, t))
    expect(pick.events.some((e) => e.type === 'collected')).toBe(true)
    expect(pick.saved).toBe(true)
    expect(JSON.parse(m.get(QUEST_STORAGE_KEY)!).collected).toBe(1)
  })

  it('finishes after the flag and then ignores fixes', () => {
    const { session, m } = setup()
    walk(session, 0, 100)
    expect(session.state.finishedAt).toBeDefined()
    expect(session.running).toBe(false)
    const before = session.state
    const late = session.handleFix(fix(500, 2000))
    expect(late.events).toEqual([])
    expect(session.state).toBe(before)
    expect(JSON.parse(m.get(QUEST_STORAGE_KEY)!).finishedAt).toBeDefined()
  })

  it('credits steps once, as they are walked, to the day of the fix', () => {
    const { session, credits, tick } = setup()
    const DAY = 86_400_000
    walk(session, 0, 20) // 200 m
    tick(2000)
    session.save()
    const total = credits.reduce((a, c) => a + c.steps, 0)
    expect(total).toBe(session.state.creditedSteps)
    expect(total).toBeGreaterThan(150)
    // Saving again with nothing new credits nothing.
    const n = credits.length
    tick(2000)
    session.save()
    expect(credits).toHaveLength(n)
    // A walk across midnight: later steps carry the later fix time.
    walk(session, 200, 5, 20 * 8 + DAY / 1000)
    tick(2000)
    session.save()
    expect(credits.at(-1)!.at).toBeGreaterThanOrEqual(DAY)
    expect(credits[0]!.at).toBeLessThan(DAY)
    // Ending adds the rest once and clears the save.
    session.end()
    expect(credits.reduce((a, c) => a + c.steps, 0)).toBe(session.state.creditedSteps)
  })

  it('credits nothing for a simulated walk', () => {
    const { session, credits, tick } = setup({ simulated: true })
    walk(session, 0, 20)
    tick(2000)
    session.save()
    session.end()
    expect(credits).toEqual([])
  })

  it('end() credits the unpaid steps and clears the save', () => {
    const { session, credits, m } = setup()
    walk(session, 0, 12)
    session.end()
    expect(credits.reduce((a, c) => a + c.steps, 0)).toBeGreaterThan(100)
    expect(m.has(QUEST_STORAGE_KEY)).toBe(false)
    // A later save or fix does not write the quest back.
    session.save()
    session.handleFix(fix(130, 200))
    expect(m.has(QUEST_STORAGE_KEY)).toBe(false)
  })

  describe('reroute requests', () => {
    function offSession() {
      const ctx = setup()
      walk(ctx.session, 0, 10)
      // A block north, then on east: off the line.
      let p = ctx.session.state.player!
      let t = 100
      for (let i = 0; i < 6; i++) ctx.session.handleFix({ ...(p = destination(p, 0, 10)), accuracy: 6, timestamp: (t += 8) * 1000 })
      for (let i = 0; i < 10; i++) ctx.session.handleFix({ ...(p = destination(p, 90, 10)), accuracy: 6, timestamp: (t += 8) * 1000 })
      expect(ctx.session.state.offRoute).toBe(true)
      return { ...ctx, p, t }
    }
    const patchFor = (s: QuestState): ReroutePatch => ({ questId: s.id, base: s.rerouted ?? 0, collected: s.collected, from: s.player!, kind: 'local', route: { ...route, distanceM: 1234 }, walked: [] })

    it('applies the newest answer only', () => {
      const { session } = offSession()
      const a = session.startReroute()
      const b = session.startReroute()
      expect(session.settleReroute(a.ticket, patchFor(a.snapshot))).toBeUndefined()
      expect(session.state.rerouted).toBeUndefined()
      expect(session.settleReroute(b.ticket, patchFor(b.snapshot))?.route.distanceM).toBe(1234)
      expect(session.state.rerouted).toBe(1)
    })

    it('ignores a failed request, a patch after end() and a patch when a gem was collected meanwhile', () => {
      const { session } = offSession()
      const a = session.startReroute()
      expect(session.settleReroute(a.ticket, undefined)).toBeUndefined()
      const b = session.startReroute()
      const patch = { ...patchFor(b.snapshot), collected: b.snapshot.collected - 1 }
      expect(session.settleReroute(b.ticket, patch)).toBeUndefined()
      const c = session.startReroute()
      session.end()
      expect(session.settleReroute(c.ticket, patchFor(c.snapshot))).toBeUndefined()
    })
  })
})
