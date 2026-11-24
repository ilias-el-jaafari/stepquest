import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { AudioEngine, setAudioEngineForTests } from './audio/engine.ts'
import { loadAudioSettings } from './audio/settings.ts'
import { DEMO_CLOCK, DEMO_DAY_MS, demoTimeScale } from './demo/script.ts'
import { I18nProvider } from './i18n/index.ts'
import { QUEST_STORAGE_KEY } from './quest/storage.ts'
import { MapRenderer } from './render/MapRenderer.ts'

// The real run takes about a minute; the test walks the same route in a few seconds.
vi.mock('./demo/script.ts', async (original) => {
  const real = await original<typeof import('./demo/script.ts')>()
  return { ...real, demoTimeScale: (metres: number) => real.demoTimeScale(metres, 4) }
})

// What the app asks of the map streamer (it would fetch vector tiles outside tests).
const streaming = vi.hoisted(() => ({ enabled: [] as (boolean | undefined)[] }))
vi.mock('./app/useStreaming.ts', async (original) => {
  const real = await original<typeof import('./app/useStreaming.ts')>()
  return {
    ...real,
    useStreaming: (args: Parameters<typeof real.useStreaming>[0]) => {
      streaming.enabled.push(args.enabled)
      return real.useStreaming(args)
    },
  }
})

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  // A device that has seen the intro, saved settings and a language: the demo ignores all of it.
  localStorage.setItem('stepquest.locale', 'en')
  localStorage.setItem('stepquest.settings', JSON.stringify({ mode: 'oneway', targetSteps: 20_000, strideM: 0.6 }))
  setAudioEngineForTests(new AudioEngine(loadAudioSettings()))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

async function waitFor(check: () => boolean, ms = 30_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 50)))
  }
}

describe('demo mode (?demo=1)', () => {
  it('plays a whole quest by itself, with no network, and ends on the summary', async () => {
    expect(demoTimeScale(1000)).toBeGreaterThan(100)
    history.replaceState(null, '', '/?demo=1&lang=es')
    streaming.enabled.length = 0
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const clocks: number[] = []
    const real = MapRenderer.prototype.setClockAt
    vi.spyOn(MapRenderer.prototype, 'setClockAt').mockImplementation(function (this: MapRenderer, ms) {
      if (ms !== undefined) clocks.push((ms - DEMO_DAY_MS) / 60_000)
      return real.call(this, ms)
    })

    const shots = vi.spyOn(MapRenderer.prototype, 'autoShot')
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    // No onboarding, no tap: the quest starts by itself, in Spanish, on the planned loop.
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    expect(document.documentElement.lang).toBe('es')
    expect(host.querySelector('[role="dialog"][aria-modal="true"]:not([data-testid])')).toBeNull()
    expect(host.querySelector('[data-testid="collected"]')?.textContent).toMatch(/^\d+\/\d+$/)

    // The camera drives itself until the first tap; the walk goes on after it.
    await waitFor(() => shots.mock.calls.length > 3)
    await act(async () => host.querySelector('[data-testid="console-screen"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    const afterTap = shots.mock.calls.length

    // It walks to the end and shows the celebration summary.
    await waitFor(() => !!host.querySelector('[data-testid="complete"][data-kind="complete"]'))
    expect(host.querySelector('[data-testid="collected"]')?.textContent).toMatch(/^(\d+)\/\1$/)
    expect(shots.mock.calls.length).toBe(afterTap)

    // The day cycle went from 18:30 to 22:30 and never backwards.
    expect(clocks.length).toBeGreaterThan(5)
    expect(clocks[0]).toBeLessThan(19 * 60)
    expect(clocks.at(-1)).toBe(DEMO_CLOCK.toMin)
    expect([...clocks].sort((a, b) => a - b)).toEqual(clocks)

    // Painting never needed the network, and nothing was left on the device.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(streaming.enabled.length).toBeGreaterThan(0)
    expect(streaming.enabled.every((e) => e === false)).toBe(true)
    expect(localStorage.getItem(QUEST_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem('stepquest.settings')!).targetSteps).toBe(20_000)
    expect(localStorage.getItem('stepquest.locale')).toBe('en')
    vi.unstubAllGlobals()
  }, 60_000)

  it('keeps the camera still for reduced motion (no swoops), and the walk still runs', async () => {
    history.replaceState(null, '', '/?demo=1')
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    const shots = vi.spyOn(MapRenderer.prototype, 'autoShot')
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    await waitFor(() => host.querySelector('[data-testid="collected"]')?.textContent?.startsWith('1/') ?? false)
    expect(shots).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  }, 60_000)

  it('a normal visit is untouched: onboarding shows and nothing plays', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[role="dialog"]'), 10_000)
    expect(host.querySelector('[data-testid="hud"]')).toBeNull()
    expect(streaming.enabled.at(-1)).toBeUndefined()
  })
})
