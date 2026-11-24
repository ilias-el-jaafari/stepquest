import { afterEach, describe, expect, it, vi } from 'vitest'
import { destination } from '../geo/geo.ts'
import { browserSource } from './geolocation.ts'
import { simulatedSource } from './simSource.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { createQuest, type QuestEvent } from './quest.ts'
import { QuestSession } from './session.ts'
import { makeTrack } from './snap.ts'
import type { GpsFix } from './types.ts'

const origin = { lat: 39.4935, lon: -0.392 }

describe('browser location source (review)', () => {
  it('drops a cached fix delivered after the page was in the background, and one from the future', () => {
    let deliver!: (p: GeolocationPosition) => void
    const geo = { watchPosition: (cb: PositionCallback) => ((deliver = cb as never), 1), clearWatch: vi.fn() } as unknown as Geolocation
    const got: GpsFix[] = []
    const now = 1_000_000
    browserSource({ geolocation: geo, secure: true }, () => now).start((f) => got.push(f), () => {})
    const pos = (timestamp: number) => ({ coords: { latitude: 39.49, longitude: -0.39, accuracy: 6 }, timestamp }) as GeolocationPosition
    deliver(pos(now - 120_000))
    deliver(pos(now + 3_600_000))
    deliver(pos(now - 2_000))
    expect(got.map((f) => f.timestamp)).toEqual([now - 2_000])
  })
})

describe('simulated source (review)', () => {
  afterEach(() => vi.useRealTimers())
  it('stops emitting in the middle of a tick when it is stopped from a fix handler', () => {
    vi.useFakeTimers()
    const track = makeTrack(Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100)))
    const got: GpsFix[] = []
    let stop = () => {}
    stop = simulatedSource(track, { timeScale: 120 }).start(
      (f) => {
        got.push(f)
        if (got.length === 2) stop()
      },
      () => {},
    )
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(2)
  })

  it('demo walk at x20 with noise and glitches collects every gem in order, finishes, and never says "you left the route"', () => {
    vi.useFakeTimers()
    const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
    const route = { mode: 'oneway' as const, points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
    const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    const q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0, sim: { timeScale: 20, noiseM: 5 } })
    const session = new QuestSession(q, { store, credit: () => {}, now: () => 0 })
    const events: QuestEvent[] = []
    const stop = simulatedSource(makeTrack(points), { timeScale: 20, noiseM: 5, glitches: true, seed: 7, startTime: 0 }).start(
      (f) => events.push(...session.handleFix(f).events),
      () => {},
    )
    vi.advanceTimersByTime(120_000)
    stop()
    expect(events.filter((e) => e.type === 'collected').map((e) => (e as { index: number }).index)).toEqual([1, 2, 3, 4])
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(1)
    expect(events.some((e) => e.type === 'offRoute')).toBe(false)
    expect(session.state.finishedAt).toBeDefined()
  })
})
