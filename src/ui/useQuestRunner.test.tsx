import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, setAudioEngineForTests } from '../audio/engine.ts'
import { loadAudioSettings } from '../audio/settings.ts'
import { destination, type LatLon } from '../geo/geo.ts'
import { I18nProvider, useI18n, type Locale } from '../i18n/index.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { createQuest, type QuestState } from '../quest/quest.ts'
import type { ReroutePatch } from '../quest/reroute.ts'
import type { QuestRoute } from '../quest/types.ts'
import { useQuestRunner } from './useQuestRunner.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const origin = { lat: 39.4935, lon: -0.392 }
const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }

type Watch = (pos: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }) => void
let watcher: Watch | undefined
let watchError: ((e: { code: number }) => void) | undefined
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof useQuestRunner> | undefined
let asked: { state: QuestState; settle: (p: ReroutePatch | undefined) => void }[] = []

let switchLocale: ((l: Locale) => void) | undefined

function Probe() {
  const { setLocale } = useI18n()
  const runner = useQuestRunner((state) => new Promise((settle) => asked.push({ state, settle })))
  useEffect(() => {
    api = runner
    switchLocale = setLocale
  })
  return null
}

beforeEach(() => {
  // The browser source drops fixes that are old against the device clock, so the clock follows the fixes.
  vi.useFakeTimers({ toFake: ['Date'] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  setAudioEngineForTests(new AudioEngine(loadAudioSettings()))
  watcher = undefined
  watchError = undefined
  asked = []
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: (cb: Watch, err: (e: { code: number }) => void) => ((watcher = cb), (watchError = err), 1), clearWatch: () => {}, getCurrentPosition: () => {} },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root.unmount())
  host.remove()
})

let clock = 0
const fix = (p: LatLon) =>
  act(async () => {
    const timestamp = (clock += 8000)
    vi.setSystemTime(timestamp + 500)
    watcher?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: 5 }, timestamp })
  })

/** 100 m along the route, then a block north and on east: a quiet-reroute situation. */
async function walkOffRoute() {
  let p = origin
  for (let i = 0; i < 10; i++) await fix((p = destination(p, 90, 10)))
  for (let i = 0; i < 6; i++) await fix((p = destination(p, 0, 10)))
  for (let i = 0; i < 12 && asked.length === 0; i++) await fix((p = destination(p, 90, 10)))
}

async function start(): Promise<QuestState> {
  await act(async () => root.render(<I18nProvider><Probe /></I18nProvider>))
  const q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 1, id: 'run' })
  await act(async () => api!.begin(q))
  return q
}

const patchFor = (state: QuestState, distanceM: number): ReroutePatch => ({ questId: state.id, base: state.rerouted ?? 0, collected: state.collected, from: state.player!, kind: 'local', route: { ...route, distanceM }, walked: [] })

describe('quest runner rerouting', () => {
  it('asks for a reroute without waiting, and merges the answer when it arrives', async () => {
    await start()
    await walkOffRoute()
    expect(asked.length).toBeGreaterThan(0)
    // The quest keeps running while the answer is pending.
    expect(api!.quest!.route.distanceM).toBe(1000)
    expect(api!.quest!.offRoute).toBe(true)
    await act(async () => asked[0]!.settle(patchFor(asked[0]!.state, 1234)))
    expect(api!.quest!.route.distanceM).toBe(1234)
    expect(api!.quest!.rerouted).toBe(1)
    expect(api!.quest!.offRoute).toBe(false)
  })

  it('ignores an answer that is not the latest request', async () => {
    await start()
    await walkOffRoute()
    let p = api!.quest!.player!
    // Keep walking until a second request is sent (the first one is still unanswered).
    for (let i = 0; i < 30 && asked.length < 2; i++) await fix((p = destination(p, 90, 10)))
    expect(asked.length).toBeGreaterThanOrEqual(2)
    await act(async () => asked[0]!.settle(patchFor(asked[0]!.state, 1111)))
    expect(api!.quest!.route.distanceM).toBe(1000)
    await act(async () => asked[1]!.settle(patchFor(asked[1]!.state, 1222)))
    expect(api!.quest!.route.distanceM).toBe(1222)
  })

  it('drops an answer for a quest that has ended', async () => {
    await start()
    await walkOffRoute()
    const first = asked[0]!
    await act(async () => api!.end())
    await act(async () => first.settle(patchFor(first.state, 1999)))
    expect(api!.quest).toBeUndefined()
  })

  it('keeps the quest as it is when no reroute fits', async () => {
    await start()
    await walkOffRoute()
    await act(async () => asked[0]!.settle(undefined))
    expect(api!.quest!.route.distanceM).toBe(1000)
    expect(api!.quest!.rerouted).toBeUndefined()
  })
})

describe('quest runner cleanup', () => {
  it('ignores a location error that arrives after the quest ended', async () => {
    await start()
    const report = watchError!
    await act(async () => api!.end())
    await act(async () => report({ code: 1 }))
    expect(api!.error).toBeUndefined()
  })

  it('shows a location error while the quest runs and clears it with the next fix', async () => {
    await start()
    await act(async () => watchError!({ code: 3 }))
    expect(api!.error).toBe('timeout')
    await fix(destination(origin, 90, 10))
    expect(api!.error).toBeUndefined()
  })

  it('does not write the quest back to storage after unmount', async () => {
    await start()
    await walkOffRoute()
    const pending = asked[0]!
    await act(async () => root.unmount())
    localStorage.clear()
    pending.settle({ questId: pending.state.id, base: 0, collected: pending.state.collected, from: pending.state.player!, kind: 'local', route: { ...route, distanceM: 1500 }, walked: [] })
    await Promise.resolve()
    expect(localStorage.length).toBe(0)
    root = createRoot(host)
  })
})

describe('quest runner language', () => {
  it('drops queued speech and warms the new language when the language changes mid-quest', async () => {
    const engine = new AudioEngine(loadAudioSettings())
    setAudioEngineForTests(engine)
    const prewarm = vi.spyOn(engine, 'prewarm')
    const stopVoice = vi.spyOn(engine, 'stopVoice')
    await start()
    prewarm.mockClear()
    stopVoice.mockClear()
    await act(async () => switchLocale!('es'))
    expect(stopVoice).toHaveBeenCalledTimes(1)
    expect(prewarm).toHaveBeenCalledTimes(1)
    const [texts, locale] = prewarm.mock.calls[0]!
    expect(locale).toBe('es')
    expect(texts.some((text) => /metros/.test(text))).toBe(true)
    expect(texts.some((text) => /\bmeters?\b/.test(text))).toBe(false)
    // Switching to the language it already speaks changes nothing.
    stopVoice.mockClear()
    await act(async () => switchLocale!('es'))
    expect(stopVoice).not.toHaveBeenCalled()
  })

  it('does not touch the voice when no quest is running', async () => {
    const engine = new AudioEngine(loadAudioSettings())
    setAudioEngineForTests(engine)
    const stopVoice = vi.spyOn(engine, 'stopVoice')
    await act(async () => root.render(<I18nProvider><Probe /></I18nProvider>))
    await act(async () => switchLocale!('es'))
    expect(stopVoice).not.toHaveBeenCalled()
  })
})
