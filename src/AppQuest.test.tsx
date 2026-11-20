import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.ts'
import { DEMO_AREA } from './osm/demoArea.ts'
import { loadDemoOsm } from './osm/demo.ts'
import { createQuest } from './quest/quest.ts'
import { loadQuest, QUEST_STORAGE_KEY, saveQuest } from './quest/storage.ts'
import { WalkGraph } from './routing/graph.ts'
import { planRoute } from './routing/planner.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

async function waitFor(check: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 50)))
  }
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

function demoQuestRoute() {
  const r = planRoute(new WalkGraph(loadDemoOsm()), { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 10_000, strideM: 0.75 }, DEMO_AREA.bbox)
  if (!r.ok) throw new Error('route')
  return r.route
}

describe('active quest UI', () => {
  it('starts a simulated quest and shows the HUD, then moves and saves progress', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    const sim = [...host.querySelectorAll('input[type="checkbox"]')][0] as HTMLInputElement
    await act(async () => sim.click())
    const speed = host.querySelector('select[aria-label="Speed"]') as HTMLSelectElement
    await act(async () => {
      speed.value = '120'
      speed.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button('Start quest')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    expect(host.textContent).toContain('Next: checkpoint 1')
    expect(host.textContent).toContain('Simulation ×120')
    expect(host.querySelector('[data-testid="collected"]')?.textContent).toBe('0/10')
    // Let the simulator walk for a moment (120× → ~2.5 min of walking per real second).
    await waitFor(() => (loadQuest(Date.now() + 3_600_000)?.odometer.totalM ?? 0) > 50, 8000)
    expect(host.querySelector('[data-testid="walked"]')?.textContent).not.toBe('0 m')
  })

  it('resumes a saved quest after a reload', async () => {
    const route = demoQuestRoute()
    const q = { ...createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: Date.now(), sim: { timeScale: 1, noiseM: 0 } }), collected: 3, alongM: 2400, odometer: { anchor: undefined, totalM: 2400 } }
    saveQuest(q)
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    expect(host.querySelector('[data-testid="collected"]')?.textContent).toBe('3/10')
    expect(host.textContent).toContain('Next: checkpoint 4')
    expect(host.textContent).toContain('Quest resumed')
  })

  it('shows the quest complete screen with stats, and "New quest" goes back to planning', async () => {
    const route = demoQuestRoute()
    const now = Date.now()
    saveQuest({
      ...createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: now - 95 * 60_000 }),
      collected: 10,
      alongM: route.distanceM,
      odometer: { anchor: undefined, totalM: 7560 },
      finishedAt: now,
      lastFixAt: now,
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="complete"]'))
    const text = host.querySelector('[data-testid="complete"]')!.textContent!
    expect(text).toContain('Quest complete!')
    expect(text).toContain('10,080') // 7,560 m / 0.75 m
    expect(text).toContain('1:35:00')
    await act(async () => button('New quest')!.click())
    await waitFor(() => !!button('Plan quest'))
    expect(localStorage.getItem(QUEST_STORAGE_KEY)).toBeNull()
  })

  it('explains a denied location permission on "Use my location"', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) },
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Use my location'))
    await act(async () => button('Use my location')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="locate-error"]'))
    expect(host.textContent).toContain('Location permission was denied')
  })

  it('sets the start from a good GPS fix inside the demo area', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 39.4901, longitude: -0.3955, accuracy: 9 }, timestamp: Date.now() }),
      },
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Use my location') && !!host.querySelector('[data-testid="map-canvas"]'))
    await act(async () => button('Use my location')!.click())
    await waitFor(() => host.textContent!.includes('39.4901, -0.3955'))
    expect(host.textContent).toContain('Start set to your location (±9 m)')
  })
})
