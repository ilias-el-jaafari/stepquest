import { beforeAll, describe, expect, it, vi } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planRoute } from '../routing/planner.ts'
import { compassPoint, directionTo } from './compass.ts'
import { judgeStartFix, locateOnce, mapGeoError, browserSource } from './geolocation.ts'
import { advanceOdometer, filterFix, type FilterState } from './gpsFilter.ts'
import { applyFix, collectRadius, createQuest, formatDuration, formatPace, nextCheckpoint, questStats, type QuestState } from './quest.ts'
import { simulatedSource } from './simSource.ts'
import { SimWalker } from './simulate.ts'
import { makeTrack, snapToRoute } from './snap.ts'
import { clearQuest, loadQuest, QUEST_MAX_AGE_MS, QUEST_STORAGE_KEY, saveQuest } from './storage.ts'
import type { GpsFix, QuestRoute } from './types.ts'
import { keepScreenOn } from './wakeLock.ts'

const origin = { lat: 39.4935, lon: -0.392 }
const fixAt = (p: LatLon, t: number, accuracy = 8): GpsFix => ({ lat: p.lat, lon: p.lon, accuracy, timestamp: t * 1000 })

/** A straight 1 km route due east with 4 checkpoints. */
function straightRoute(): QuestRoute {
  const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
  return { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
}

function newQuest(route = straightRoute()) {
  return createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 'test' })
}

function feed(q: QuestState, fixes: GpsFix[]) {
  const events = []
  for (const f of fixes) {
    const r = applyFix(q, f)
    q = r.state
    events.push(...r.events)
  }
  return { q, events }
}

describe('GPS noise filter', () => {
  it('accepts the first good fix as-is', () => {
    const r = filterFix(undefined, fixAt(origin, 0))
    expect(r.accepted).toBe(true)
  })
  it('rejects fixes worse than the accuracy threshold', () => {
    const r = filterFix(undefined, fixAt(origin, 0, 80))
    expect(r).toMatchObject({ accepted: false, reason: 'inaccurate' })
  })
  it('rejects stale or duplicate timestamps', () => {
    const first = filterFix(undefined, fixAt(origin, 10))
    if (!first.accepted) throw new Error()
    expect(filterFix(first.state, fixAt(origin, 10))).toMatchObject({ accepted: false, reason: 'stale' })
    expect(filterFix(first.state, fixAt(origin, 5))).toMatchObject({ accepted: false, reason: 'stale' })
  })
  it('drops an impossible jump but accepts it after repeated agreement', () => {
    let state = (filterFix(undefined, fixAt(origin, 0)) as { state: FilterState }).state
    const far = destination(origin, 0, 500)
    const r1 = filterFix(state, fixAt(far, 2))
    expect(r1).toMatchObject({ accepted: false, reason: 'tooFast' })
    state = r1.state!
    const r2 = filterFix(state, fixAt(far, 3))
    expect(r2.accepted).toBe(false)
    const r3 = filterFix(r2.state, fixAt(far, 4))
    expect(r3.accepted).toBe(true)
    if (r3.accepted) expect(haversine(r3.position, far)).toBeLessThan(1)
  })
  it('smooths jitter: a stationary walker with ±10 m noise stays within a few metres', () => {
    const walker = new SimWalker(makeTrack([origin, destination(origin, 90, 1)]), { speedKmh: 0, noiseM: 10, seed: 3 })
    let state: FilterState | undefined
    let last: LatLon = origin
    for (let t = 0; t < 120; t++) {
      const r = filterFix(state, { ...walker.fixAt(t), accuracy: 10 })
      if (r.accepted) last = r.position
      state = r.state
    }
    expect(haversine(last, origin)).toBeLessThan(5)
  })
  it('the odometer ignores jitter while standing still and counts real movement', () => {
    let odo = { anchor: undefined as LatLon | undefined, totalM: 0 }
    for (let i = 0; i < 50; i++) odo = advanceOdometer(odo, destination(origin, i * 37, 2), 8)
    expect(odo.totalM).toBe(0)
    for (let i = 0; i <= 100; i++) odo = advanceOdometer(odo, destination(origin, 90, i * 5), 8)
    expect(odo.totalM).toBeGreaterThan(450)
    expect(odo.totalM).toBeLessThanOrEqual(505)
  })
})

describe('snapping to the route', () => {
  const track = makeTrack(straightRoute().points)
  it('projects onto the nearest segment with distance along and offset', () => {
    const p = destination(destination(origin, 90, 250), 0, 12)
    const s = snapToRoute(track, p)
    expect(s.alongM).toBeCloseTo(250, 0)
    expect(s.offsetM).toBeCloseTo(12, 0)
  })
  it('clamps to the ends', () => {
    expect(snapToRoute(track, destination(origin, 270, 50)).alongM).toBe(0)
    expect(snapToRoute(track, destination(origin, 90, 1200)).alongM).toBeCloseTo(1000, 0)
  })
  it('stays on the current pass of a loop that crosses itself', () => {
    // Out east 500 m, then back west along a line 5 m north.
    const out = Array.from({ length: 6 }, (_, i) => destination(origin, 90, i * 100))
    const back = Array.from({ length: 6 }, (_, i) => destination(destination(origin, 0, 5), 90, 500 - i * 100))
    const loop = makeTrack([...out, ...back])
    const p = destination(origin, 90, 200)
    expect(snapToRoute(loop, p, 180).alongM).toBeLessThan(300)
    expect(snapToRoute(loop, destination(destination(origin, 0, 5), 90, 200), 780).alongM).toBeGreaterThan(700)
  })
})

describe('checkpoint collection', () => {
  it('scales the pickup radius with accuracy, within limits', () => {
    expect(collectRadius(5)).toBe(22)
    expect(collectRadius(20)).toBe(27)
    expect(collectRadius(200)).toBe(35)
  })
  it('collects checkpoints in route order when walking past them', () => {
    let q = newQuest()
    const fixes = Array.from({ length: 101 }, (_, i) => fixAt(destination(origin, 90, i * 10), i * 7))
    const r = feed(q, fixes)
    q = r.q
    const pickups = r.events.filter((e) => e.type === 'collected').map((e) => (e as { index: number }).index)
    expect(pickups).toEqual([1, 2, 3, 4])
    expect(q.finishedAt).toBeDefined()
    expect(r.events.filter((e) => e.type === 'finished')).toHaveLength(1)
  })
  it('does not collect a later checkpoint before the earlier ones', () => {
    const q = newQuest()
    // Teleport-free path that reaches checkpoint 2 (500 m) from the side, never passing checkpoint 1 on the route.
    const cp2 = q.route.checkpoints[1]!.point
    const r = applyFix(q, fixAt(cp2, 0))
    expect(r.state.collected).toBe(0)
    expect(r.events.some((e) => e.type === 'collected')).toBe(false)
  })
  it('collects within the radius but not outside it', () => {
    const q = { ...newQuest(), alongM: 200 }
    const cp1 = q.route.checkpoints[0]!.point // 250 m
    // 30 m north of the checkpoint with good accuracy: off the route line and outside 22 m.
    const miss = applyFix(q, fixAt(destination(cp1, 0, 30), 0, 5))
    expect(miss.state.collected).toBe(0)
    const hit = applyFix(q, fixAt(destination(cp1, 0, 18), 0, 5))
    expect(hit.state.collected).toBe(1)
  })
  it('is more forgiving with poor accuracy', () => {
    const q = { ...newQuest(), alongM: 200 }
    const near = destination(q.route.checkpoints[0]!.point, 0, 30)
    expect(applyFix(q, fixAt(near, 0, 5)).state.collected).toBe(0)
    expect(applyFix(q, fixAt(near, 0, 30)).state.collected).toBe(1)
  })
  it('ignores rejected fixes and reports weak signal', () => {
    const q = newQuest()
    const r = applyFix(q, fixAt(q.route.checkpoints[0]!.point, 0, 120))
    expect(r.state.collected).toBe(0)
    expect(r.events).toEqual([{ type: 'rejected', reason: 'inaccurate' }])
    expect(r.state.weakSince).toBe(0)
  })
  it('marks the walker off the line after two far fixes, without the message yet, and clears it on return', () => {
    let q = newQuest()
    q = applyFix(q, fixAt(destination(origin, 90, 100), 0)).state
    const away = destination(destination(origin, 90, 120), 0, 90)
    const r1 = applyFix(q, fixAt(away, 30))
    expect(r1.state.offRoute).toBe(false)
    const r2 = applyFix(r1.state, fixAt(destination(away, 0, 5), 40))
    expect(r2.state.offRoute).toBe(true)
    // Not judged yet: the message waits until the walker clearly heads away.
    expect(r2.events).not.toContainEqual({ type: 'offRoute' })
    expect(r2.state.lost).toBe(false)
    const back = applyFix(r2.state, fixAt(destination(origin, 90, 140), 80))
    expect(back.state.offRoute).toBe(false)
    expect(back.state.offStart).toBeUndefined()
  })
  it('only finishes a loop after every checkpoint, even though it starts at the flag', () => {
    const out = Array.from({ length: 6 }, (_, i) => destination(origin, 90, i * 100))
    const back = Array.from({ length: 5 }, (_, i) => destination(destination(origin, 0, 60), 90, 400 - i * 100))
    const points = [...out, ...back, origin]
    const route: QuestRoute = { mode: 'loop', points, distanceM: makeTrack(points).total, steps: 0, targetSteps: 0, checkpoints: placeCheckpoints(points, 3) }
    const q = newQuest(route)
    const r = applyFix(q, fixAt(origin, 0))
    expect(r.state.collected).toBe(0)
    expect(r.state.finishedAt).toBeUndefined()
  })
  it('ignores fixes after the finish', () => {
    const q = { ...newQuest(), finishedAt: 5 }
    expect(applyFix(q, fixAt(origin, 10)).events).toEqual([])
  })
})

describe('stats and formatting', () => {
  it('derives steps, pace and time', () => {
    const q = { ...newQuest(), odometer: { anchor: origin, totalM: 1500 }, collected: 2, alongM: 600 }
    const s = questStats(q, 15 * 60_000)
    expect(s.steps).toBe(2000)
    expect(s.paceMinPerKm).toBeCloseTo(10, 6)
    expect(s.remainingM).toBe(400)
    expect(s.collected).toBe(2)
    expect(s.total).toBe(4)
    expect(nextCheckpoint(q)?.index).toBe(3)
  })
  it('formats durations and paces', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(formatPace(9.5)).toBe(`9'30"`)
    expect(formatPace(undefined)).toBe('--')
  })
  it('names compass directions', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(44)).toBe('NE')
    expect(compassPoint(181)).toBe('S')
    expect(compassPoint(350)).toBe('N')
    expect(directionTo(origin, destination(origin, 270, 100)).point).toBe('W')
  })
})

describe('persistence and resume', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
  }
  it('saves and restores a quest mid-route, and the restored quest keeps going', () => {
    const store = memory()
    const fixes = Array.from({ length: 101 }, (_, i) => fixAt(destination(origin, 90, i * 10), i * 7))
    const half = feed(newQuest(), fixes.slice(0, 50)).q
    expect(half.collected).toBe(1)
    expect(saveQuest(half, store)).toBe(true)
    const restored = loadQuest(400_000, store)!
    expect(restored).toEqual(JSON.parse(JSON.stringify(half)))
    const done = feed(restored, fixes.slice(50)).q
    expect(done.collected).toBe(4)
    expect(done.finishedAt).toBeDefined()
  })
  it('discards corrupt, foreign-version or stale saves', () => {
    const store = memory()
    store.setItem(QUEST_STORAGE_KEY, '{not json')
    expect(loadQuest(0, store)).toBeUndefined()
    expect(store.m.has(QUEST_STORAGE_KEY)).toBe(false)
    saveQuest({ ...newQuest(), v: 9 as 1 }, store)
    expect(loadQuest(0, store)).toBeUndefined()
    saveQuest(newQuest(), store)
    expect(loadQuest(QUEST_MAX_AGE_MS + 1, store)).toBeUndefined()
  })
  it('clears on request', () => {
    const store = memory()
    saveQuest(newQuest(), store)
    clearQuest(store)
    expect(loadQuest(0, store)).toBeUndefined()
  })
  it('uses real localStorage by default', () => {
    localStorage.clear()
    saveQuest(newQuest())
    expect(loadQuest(1000)?.id).toBe('test')
    clearQuest()
  })
})

describe('geolocation helpers', () => {
  it('maps browser error codes', () => {
    expect(mapGeoError({ code: 1 })).toBe('denied')
    expect(mapGeoError({ code: 2 })).toBe('unavailable')
    expect(mapGeoError({ code: 3 })).toBe('timeout')
  })
  it('judges start accuracy', () => {
    expect(judgeStartFix(fixAt(origin, 0, 15))).toMatchObject({ ok: true, weak: false })
    expect(judgeStartFix(fixAt(origin, 0, 120))).toMatchObject({ ok: true, weak: true })
    expect(judgeStartFix(fixAt(origin, 0, 900))).toMatchObject({ ok: false, code: 'inaccurate' })
  })
  it('refuses insecure pages and missing APIs', async () => {
    expect(await locateOnce({ secure: false })).toEqual({ ok: false, code: 'insecure' })
    expect(await locateOnce({ secure: true })).toEqual({ ok: false, code: 'unsupported' })
  })
  it('reports permission denied and timeouts from the browser', async () => {
    const geo = (code: number) =>
      ({ getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code }) }) as unknown as Geolocation
    expect(await locateOnce({ secure: true, geolocation: geo(1) })).toEqual({ ok: false, code: 'denied' })
    expect(await locateOnce({ secure: true, geolocation: geo(3) })).toEqual({ ok: false, code: 'timeout' })
  })
  it('passes a good position through', async () => {
    const geolocation = {
      getCurrentPosition: (ok: (p: GeolocationPosition) => void) =>
        ok({ coords: { latitude: 39.5, longitude: -0.39, accuracy: 12 }, timestamp: 5 } as GeolocationPosition),
    } as unknown as Geolocation
    expect(await locateOnce({ secure: true, geolocation })).toEqual({ ok: true, weak: false, fix: { lat: 39.5, lon: -0.39, accuracy: 12, timestamp: 5 } })
  })
  it('watches with high accuracy and stops cleanly', () => {
    const clearWatch = vi.fn()
    let options: PositionOptions | undefined
    const geolocation = {
      watchPosition: (_ok: unknown, _err: unknown, o: PositionOptions) => {
        options = o
        return 7
      },
      clearWatch,
    } as unknown as Geolocation
    const stop = browserSource({ secure: true, geolocation }).start(() => {}, () => {})
    expect(options?.enableHighAccuracy).toBe(true)
    stop()
    expect(clearWatch).toHaveBeenCalledWith(7)
  })
})

describe('wake lock', () => {
  it('requests the screen lock, re-acquires when visible again and releases', async () => {
    const released = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release: released, released: false }))
    const listeners: Record<string, () => void> = {}
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (t: string, cb: () => void) => void (listeners[t] = cb),
      removeEventListener: vi.fn(),
    }
    const handle = keepScreenOn({ request }, doc as never)
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledWith('screen')
    expect(handle.active()).toBe(true)
    handle.release()
    expect(released).toHaveBeenCalled()
    expect(handle.active()).toBe(false)
  })
  it('is a harmless no-op when unsupported', () => {
    const handle = keepScreenOn(undefined, undefined)
    expect(handle.active()).toBe(false)
    handle.release()
  })
})

describe('simulated walk, end to end on the Benicalap fixture', () => {
  let route: QuestRoute
  beforeAll(() => {
    const graph = new WalkGraph(loadDemoOsm())
    const r = planRoute(graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 10_000, strideM: 0.75 }, DEMO_AREA.bbox)
    if (!r.ok) throw new Error('route failed')
    route = r.route
  })

  for (const [label, noiseM, glitches] of [['perfect GPS', 0, false], ['noisy GPS with glitches', 6, true]] as const) {
    it(`collects all 10 checkpoints in order and finishes (${label})`, () => {
      const track = makeTrack(route.points)
      const walker = new SimWalker(track, { speedKmh: 5, noiseM, glitches, seed: 11 })
      let q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0 })
      const order: number[] = []
      let finished = 0
      for (let t = 0; !walker.done(t - 6) && t < 20_000; t += 2) {
        const r = applyFix(q, walker.fixAt(t))
        q = r.state
        for (const e of r.events) {
          if (e.type === 'collected') order.push(e.index)
          if (e.type === 'finished') finished++
        }
      }
      expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(finished).toBe(1)
      const stats = questStats(q, 0)
      // The odometer should be within 10 % of the true route length.
      expect(Math.abs(stats.walkedM - route.distanceM) / route.distanceM).toBeLessThan(0.1)
      expect(Math.abs(stats.steps - route.steps) / route.steps).toBeLessThan(0.1)
      // ~5 km/h → about 12 min/km.
      expect(stats.paceMinPerKm).toBeGreaterThan(10)
      expect(stats.paceMinPerKm).toBeLessThan(14)
    })
  }

  it('resumes a simulated walk from saved progress after a "reload"', () => {
    const track = makeTrack(route.points)
    let q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0 })
    const first = new SimWalker(track, { speedKmh: 5, noiseM: 3, seed: 5 })
    for (let t = 0; t < 1800; t += 2) q = applyFix(q, first.fixAt(t)).state
    expect(q.collected).toBeGreaterThanOrEqual(2)
    expect(q.collected).toBeLessThan(10)
    localStorage.clear()
    saveQuest(q)
    const restored = loadQuest(q.lastFixAt! + 1000)!
    const resume = new SimWalker(track, { speedKmh: 5, noiseM: 3, seed: 6, startAlongM: restored.alongM, startTime: restored.lastFixAt! + 2000 })
    let r = restored
    for (let t = 0; !resume.done(t - 6); t += 2) r = applyFix(r, resume.fixAt(t)).state
    expect(r.collected).toBe(10)
    expect(r.finishedAt).toBeDefined()
    clearQuest()
  })

  it('the timed simulated source emits dense fixes and stops at the end', () => {
    vi.useFakeTimers()
    const track = makeTrack(route.points.slice(0, 20))
    const fixes: GpsFix[] = []
    const stop = simulatedSource(track, { timeScale: 60, noiseM: 0, startTime: 0 }).start((f) => fixes.push(f), () => {})
    vi.advanceTimersByTime(60_000)
    stop()
    vi.useRealTimers()
    expect(fixes.length).toBeGreaterThan(5)
    for (let i = 1; i < fixes.length; i++) expect(fixes[i]!.timestamp - fixes[i - 1]!.timestamp).toBe(2000)
    const last = fixes.at(-1)!
    expect(haversine(last, track.points.at(-1)!)).toBeLessThan(1)
  })
})
