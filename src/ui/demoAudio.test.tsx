import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, setAudioEngineForTests } from '../audio/engine.ts'
import { FakeContext, fakeWindow } from '../audio/fakeAudio.ts'
import type { Graph } from '../audio/graph.ts'
import { themeReady } from '../audio/musicPlayer.ts'
import { DEFAULT_AUDIO } from '../audio/settings.ts'
import { destination, type LatLon } from '../geo/geo.ts'
import { I18nProvider } from '../i18n/index.ts'
import { createQuest } from '../quest/quest.ts'
import type { QuestRoute } from '../quest/types.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { useQuestRunner } from './useQuestRunner.ts'

/**
 * The self-playing demo (`?demo=1`) walks a simulated quest through the normal runner,
 * so its sound is the normal path: nothing starts before the first tap, then the loop plays
 * and the jingles fire at the gems and the finish. Here the same path runs with a fake AudioContext
 * (the demo's simulator and this test both feed GPS fixes to the same runner).
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const origin = { lat: 39.4935, lon: -0.392 }
const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }

type Watch = (pos: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }) => void
let watcher: Watch | undefined
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof useQuestRunner> | undefined
let page: ReturnType<typeof fakeWindow>
let engine: AudioEngine
let clock = 0

function Probe() {
  const runner = useQuestRunner(() => new Promise(() => {}))
  useEffect(() => {
    api = runner
  })
  return null
}

const fix = (p: LatLon) =>
  act(async () => {
    const timestamp = (clock += 8000)
    vi.setSystemTime(timestamp + 500)
    const audio = FakeContext.instances[0]
    if (audio) audio.currentTime += 8
    watcher?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 5 }, timestamp })
  })

beforeAll(() => themeReady())
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  FakeContext.instances = []
  clock = 0
  page = fakeWindow()
  engine = new AudioEngine({ ...DEFAULT_AUDIO }, page.win)
  setAudioEngineForTests(engine)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: (cb: Watch) => ((watcher = cb), 1), clearWatch: () => {}, getCurrentPosition: () => {} },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<I18nProvider><Probe /></I18nProvider>))
})
afterEach(async () => {
  engine.dispose()
  vi.useRealTimers()
  await act(async () => root.unmount())
  host.remove()
  setAudioEngineForTests(undefined)
})

describe('demo mode sound', () => {
  it('starts silent, plays after the first tap, fires a jingle for each gem, the last gem and the finish, and stops the loop at the end', async () => {
    const sfx = vi.spyOn(engine, 'playSfx')
    const q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 1, id: 'demo-audio' })
    // The demo begins without a tap (autoplay rules): no AudioContext yet.
    await act(async () => api!.begin(q, false, false))
    expect(FakeContext.instances).toHaveLength(0)
    expect(engine.getSnapshot().music).toBe('paused')

    // The first tap unlocks sound.
    page.fire('pointerup')
    expect(FakeContext.instances).toHaveLength(1)
    const ctx = FakeContext.instances[0]!
    const graph = (engine as unknown as { graph: Graph }).graph

    let p: LatLon = origin
    for (let i = 0; i < 40; i++) await fix((p = destination(p, 90, 12)))
    expect(engine.getSnapshot().music).toBe('playing') // the loop follows the walking pace
    expect(engine.tempo).toBeGreaterThanOrEqual(84)
    expect(engine.tempo).toBeLessThanOrEqual(150)
    for (let i = 0; i < 60 && api!.quest?.finishedAt === undefined; i++) await fix((p = destination(p, 90, 12)))
    expect(api!.quest!.finishedAt).toBeDefined()

    const names = sfx.mock.calls.map((c) => c[0]).filter((n) => n !== 'click')
    expect(names).toEqual(['gem', 'gem', 'gemLast', 'finish'])
    // Each jingle ducked the loop (down, then back up).
    const duck = (graph.jingleDuck as unknown as { gain: { events: { kind: string; value: number }[] } }).gain.events.filter((e) => e.kind === 'target')
    expect(duck.map((e) => e.value)).toEqual([0.33, 1, 0.33, 1, 0.33, 1, 0.33, 1])
    // The loop stopped at the finish; the fanfare tail is the only thing left.
    expect(engine.getSnapshot().music).toBe('off')
    const n = ctx.oscillators.length
    ctx.currentTime += 5
    vi.advanceTimersByTime(1000)
    expect(ctx.oscillators.length).toBe(n)
  })

  it('stays silent from first to last when sound is muted, with nothing created', async () => {
    engine.dispose()
    page = fakeWindow()
    engine = new AudioEngine({ ...DEFAULT_AUDIO, muted: true }, page.win)
    setAudioEngineForTests(engine)
    const q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 1, id: 'demo-muted' })
    await act(async () => api!.begin(q, false, false))
    page.fire('pointerup')
    let p: LatLon = origin
    for (let i = 0; i < 100 && api!.quest?.finishedAt === undefined; i++) await fix((p = destination(p, 90, 12)))
    expect(api!.quest!.finishedAt).toBeDefined()
    expect(FakeContext.instances).toHaveLength(0)
  })
})
