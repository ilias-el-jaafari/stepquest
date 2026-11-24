import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination } from '../geo/geo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { migrateQuest, routeNearBbox } from './migrate.ts'
import { applyFix, createQuest, QUEST_VERSION, type QuestState } from './quest.ts'
import { clearQuest, loadQuest, QUEST_STORAGE_KEY, saveQuest } from './storage.ts'
import type { QuestRoute } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }
const east = (m: number) => destination(origin, 90, m)
const points = Array.from({ length: 11 }, (_, i) => east(i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
const fresh = (): QuestState => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 1000, id: 'p' })

function memory() {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

/** What version 1 of the app wrote: no `creditedSteps`, no filter extras. */
function savedV1(): Record<string, unknown> {
  const { creditedSteps: _drop, ...rest } = fresh() as QuestState & { creditedSteps?: number }
  return { ...rest, v: 1 }
}

describe('saved quest versions (64.7)', () => {
  it('is on version 2', () => expect(QUEST_VERSION).toBe(2))

  it('migrates a version 1 save mid-walk and the quest keeps going', () => {
    let q = fresh()
    for (let i = 1; i <= 8; i++) q = applyFix(q, { ...east(i * 30), accuracy: 6, timestamp: 1000 + i * 8000 }).state
    const store = memory()
    store.setItem(QUEST_STORAGE_KEY, JSON.stringify({ ...q, v: 1, creditedSteps: undefined }))
    const loaded = loadQuest(q.lastFixAt! + 1000, store)!
    expect(loaded.v).toBe(2)
    expect(loaded.creditedSteps).toBe(0)
    expect(loaded.odometer.totalM).toBe(q.odometer.totalM)
    const next = applyFix(loaded, { ...east(260), accuracy: 6, timestamp: q.lastFixAt! + 8000 })
    expect(next.state.collected).toBe(1)
  })

  it('leaves a save from a newer app in storage and does not resume it', () => {
    const store = memory()
    const raw = JSON.stringify({ ...fresh(), v: 3, brandNew: true })
    store.setItem(QUEST_STORAGE_KEY, raw)
    expect(loadQuest(2000, store)).toBeUndefined()
    expect(store.getItem(QUEST_STORAGE_KEY)).toBe(raw)
    expect(migrateQuest(JSON.parse(raw))).toEqual({ ok: false, reason: 'newer' })
  })

  it('refuses and clears inconsistent saves instead of finishing at the next fix', () => {
    const bad: Record<string, unknown>[] = [
      { ...fresh(), collected: 5 },
      { ...fresh(), collected: -1 },
      { ...fresh(), collected: 1.5 },
      { ...fresh(), strideM: 0 },
      { ...fresh(), finishedAt: 5000 },
      { ...fresh(), odometer: { anchor: undefined, totalM: Number.NaN } },
      { ...fresh(), route: { ...route, points: [origin] } },
      { ...fresh(), route: { ...route, checkpoints: [] } },
      { ...fresh(), area: { kind: 'live', bbox: { south: 1 } } },
      { ...fresh(), area: { kind: 'moon' } },
      { ...savedV1(), alongM: 'far' },
    ]
    for (const q of bad) {
      const store = memory()
      store.setItem(QUEST_STORAGE_KEY, JSON.stringify(q))
      expect(loadQuest(2000, store)).toBeUndefined()
      expect(store.getItem(QUEST_STORAGE_KEY)).toBeNull()
    }
  })

  it('round-trips any quest state reached by walking (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1100, noNaN: true }), { minLength: 1, maxLength: 40 }), (alongs) => {
        let q = fresh()
        let t = 1000
        for (const a of alongs) q = applyFix(q, { ...east(a), accuracy: 7, timestamp: (t += 8000) }).state
        const store = memory()
        expect(saveQuest(q, store)).toBe(true)
        const back = loadQuest(t + 1000, store)
        expect(back).toEqual(JSON.parse(JSON.stringify(q)))
        clearQuest(store)
        expect(loadQuest(t, store)).toBeUndefined()
      }),
      { numRuns: 60 },
    )
  })
})

describe('does the saved route belong on this map (64.7)', () => {
  const box = { south: 39.49, west: -0.396, north: 39.497, east: -0.378 }
  it('accepts a route on the map and refuses one elsewhere', () => {
    expect(routeNearBbox(route, box)).toBe(true)
    const far = (p: { lat: number; lon: number }) => ({ lat: p.lat + 1, lon: p.lon })
    expect(routeNearBbox({ ...route, points: route.points.map(far), checkpoints: route.checkpoints.map((c) => ({ ...c, point: far(c.point) })) }, box)).toBe(false)
  })
})
