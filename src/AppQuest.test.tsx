import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { AudioEngine, setAudioEngineForTests } from './audio/engine.ts'
import { loadAudioSettings } from './audio/settings.ts'
import { I18nProvider } from './i18n/index.ts'
import { en } from './i18n/en.ts'
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
  localStorage.setItem('stepquest.onboarded', '1')
  setAudioEngineForTests(new AudioEngine(loadAudioSettings()))
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
  it('asks for calm menu music on the planning screen, then quest music on start', async () => {
    const { audioEngine } = await import('./audio/engine.ts')
    const menu = vi.spyOn(audioEngine(), 'playMenuMusic')
    const quest = vi.spyOn(audioEngine(), 'startMusic')
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    expect(menu).toHaveBeenCalledTimes(1)
    expect(audioEngine().getSnapshot().musicMode).toBe('menu')
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    await act(async () => button('Start quest')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    expect(quest).toHaveBeenCalledTimes(1)
    expect(audioEngine().getSnapshot().musicMode).toBe('quest')
  })

  it('plans without safety switches or notes on the main screen, and explains safety in Info', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    expect(host.querySelector('[data-testid="avoid-streets"] input[type="checkbox"]')).toBeNull()
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    expect(host.querySelector('[data-testid="safety-notice"]')).toBeNull()
    const mainText = host.querySelector('main')!.textContent ?? ''
    expect(mainText.match(/.{0,60}(safer route|after dark|lighting).{0,60}/i)?.[0]).toBeUndefined()
    await act(async () => (host.querySelector('[data-testid="info-button"]') as HTMLButtonElement).click())
    const info = host.querySelector('[data-testid="info-panel"]')!
    expect(info.textContent).toContain('Are the routes safe?')
    expect(info.textContent).toMatch(/sunset \d{2}:\d{2}/)
  })

  it('starts a simulated quest and shows the HUD, then moves and saves progress', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    const sim = host.querySelector('.quest-start input[type="checkbox"]') as HTMLInputElement
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

  it('speaks the opening line on start and has a sound button in the HUD', async () => {
    const { audioEngine } = await import('./audio/engine.ts')
    const say = vi.spyOn(audioEngine(), 'say')
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    await act(async () => button('Start quest')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    expect(say).toHaveBeenCalledTimes(1)
    expect(say.mock.calls[0]![0]).toMatch(/^Quest started! First gem in \d+ meters, [a-z-]+\.$/)
    // Alerts only: the story dialogue box on screen is not read out.
    const dialog = host.querySelector('.dialog')
    expect(dialog).not.toBeNull()
    await act(async () => new Promise((r) => setTimeout(r, 1500)))
    expect(say).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.hud-bottom [data-testid="sound-button"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Sound off')
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

  it('shows the quest complete screen with stats, and "Plan another quest" goes back to planning', async () => {
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
    const { audioEngine } = await import('./audio/engine.ts')
    const menu = vi.spyOn(audioEngine(), 'playMenuMusic')
    await act(async () => button('Plan another quest')!.click())
    await waitFor(() => !!button('Plan quest'))
    // Back on the planning screen the calm menu music takes over.
    expect(menu).toHaveBeenCalled()
    expect(audioEngine().getSnapshot().musicMode).toBe('menu')
    expect(localStorage.getItem(QUEST_STORAGE_KEY)).toBeNull()
    // A simulated walk does not count as steps walked today.
    expect(host.querySelector('[data-testid="steps-today"] strong')!.textContent).toBe('0')
  })

  it('"Back to map" closes the finished summary and keeps the quest on the map', async () => {
    const route = demoQuestRoute()
    const now = Date.now()
    saveQuest({
      ...createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: now - 60_000 }),
      collected: route.checkpoints.length,
      alongM: route.distanceM,
      odometer: { anchor: undefined, totalM: 600 },
      finishedAt: now,
      lastFixAt: now,
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="summary-back"]'))
    expect(host.querySelector('[data-testid="summary-gems"]')!.textContent).toBe(`${route.checkpoints.length}/${route.checkpoints.length}`)
    await act(async () => (host.querySelector('[data-testid="summary-back"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="complete"]')).toBeNull()
    expect(host.querySelector('[data-testid="hud"]')).not.toBeNull()
  })

  it('has a bottom tab bar that switches between map, bag, hero and settings', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest'))
    const panel = (name: string) => host.querySelector<HTMLElement>(`#tabpanel-${name}`)!
    const tab = (name: string) => host.querySelector<HTMLButtonElement>(`[data-testid="tab-${name}"]`)!
    expect(tab('map').getAttribute('aria-selected')).toBe('true')
    expect(panel('map').hidden).toBe(false)
    for (const name of ['bag', 'hero', 'settings', 'map']) {
      await act(async () => tab(name).click())
      for (const other of ['map', 'bag', 'hero', 'settings']) {
        expect(panel(other).hidden).toBe(other !== name)
        expect(tab(other).getAttribute('aria-selected')).toBe(String(other === name))
      }
    }
    // Settings holds the sound controls, the language and the help; Hero holds the stride.
    expect(panel('settings').querySelector('[data-testid="volume-master"]')).not.toBeNull()
    expect(panel('settings').querySelector('[data-testid="info-button"]')).not.toBeNull()
    expect(panel('hero').querySelector('input[name="stride"]')).not.toBeNull()
    expect(panel('bag').querySelector('[data-testid="avoid-streets"]')).not.toBeNull()
    // The map tab keeps only the planner: steps and the plan button.
    expect(panel('map').querySelector('input[name="steps"]')).not.toBeNull()
    expect(panel('map').querySelector('[data-testid="avoid-streets"]')).toBeNull()
    // Picking a street to avoid jumps to the map and shows a banner with Cancel.
    await act(async () => tab('bag').click())
    await act(async () => button('Pick on map')!.click())
    expect(panel('map').hidden).toBe(false)
    expect(host.querySelector('.map-banner')?.textContent).toContain('Tap a street on the map')
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.map-banner button')][0]!.click())
    expect(panel('bag').hidden).toBe(false)
    expect(host.querySelector('.map-banner')).toBeNull()
  })

  it('shows today\'s steps in the header', async () => {
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('stepquest.dailySteps', JSON.stringify({ day, steps: 12450 }))
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest'))
    expect(host.querySelector('[data-testid="steps-today"]')!.textContent).toContain('Steps today: 12,450')
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100')
  })

  it('shows the finish dialogue, stops watchPosition and hides signal warnings when a real quest ends', async () => {
    const route = demoQuestRoute()
    const cps = route.checkpoints
    const finish = cps[cps.length - 1]!
    const now = Date.now()
    let emit: ((pos: unknown) => void) | undefined
    const clearWatch = vi.fn()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn((ok: (pos: unknown) => void) => {
          emit = ok
          return 7
        }),
        clearWatch,
        getCurrentPosition: vi.fn(),
      },
    })
    saveQuest({
      ...createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: now - 60 * 60_000 }),
      collected: cps.length - 1,
      alongM: finish.distanceM - 4,
      odometer: { anchor: undefined, totalM: finish.distanceM - 4 },
      // The last fix is old: before finishing, the HUD would warn that the signal is lost.
      lastFixAt: now - 5 * 60_000,
      weakSince: now - 5 * 60_000,
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="hud"]') && !!emit)
    expect(host.textContent).toContain(en['quest.lost'])
    expect(clearWatch).not.toHaveBeenCalled()
    await act(async () => emit!({ coords: { latitude: finish.point.lat, longitude: finish.point.lon, accuracy: 5 }, timestamp: Date.now() }))
    await waitFor(() => !!host.querySelector('[data-testid="dialog-finish"]'))
    expect(clearWatch).toHaveBeenCalledWith(7)
    expect(host.textContent).not.toContain(en['quest.lost'])
    expect(host.textContent).not.toContain('Weak GPS')
    expect(host.querySelector('.hud-msg.warn, .hud-msg.bad')).toBeNull()
    // A late fix after the end changes nothing.
    await act(async () => emit!({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: Date.now() + 1000 }))
    // Advance the dialogue until the results screen appears.
    await waitFor(() => {
      const box = host.querySelector<HTMLElement>('.dialog')
      if (box) box.click()
      return !!host.querySelector('[data-testid="complete"]')
    })
    expect(host.querySelector('.hud-msg.warn, .hud-msg.bad')).toBeNull()
    expect(host.textContent).not.toContain(en['quest.lost'])
    // Back to planning: the real walk counts towards today's steps in the header.
    await act(async () => button('Plan another quest')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="steps-today"]'))
    const today = Number(host.querySelector('[data-testid="steps-today"] strong')!.textContent!.replace(/[^\d]/g, ''))
    expect(today).toBeGreaterThan(Math.round((finish.distanceM - 4) / 0.75) - 5)
  })

  it('uses singular wording in Spanish for a one-checkpoint quest and shows no lost-signal banner', async () => {
    localStorage.setItem('stepquest.locale', 'es')
    const full = demoQuestRoute()
    const last = full.checkpoints[full.checkpoints.length - 1]!
    const route = { ...full, checkpoints: [{ ...last, index: 1 }] }
    const now = Date.now()
    saveQuest({
      ...createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: now - 10 * 60_000 }),
      collected: 1,
      alongM: route.distanceM,
      odometer: { anchor: undefined, totalM: 445 },
      finishedAt: now - 3 * 60_000,
      lastFixAt: now - 3 * 60_000,
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="complete"]'))
    expect(host.textContent).toContain('¡Misión completada!')
    expect(host.querySelector('[data-testid="summary-gems"]')!.textContent).toBe('1/1')
    expect(host.textContent).not.toContain('Señal perdida')
    expect(host.querySelector('.hud-msg.warn, .hud-msg.bad')).toBeNull()
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
    expect(host.textContent).toContain(en['loc.err.denied'])
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

  it('sets the start from GPS by itself at launch when location is already allowed', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 39.4901, longitude: -0.3955, accuracy: 9 }, timestamp: Date.now() }) },
    })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => host.textContent!.includes('39.4901, -0.3955'))
    expect(host.querySelector('[data-testid="area-toast"]')).toBeNull()
  })

  it('offers planning where you are when permission was not given yet, and hides coordinates under Advanced', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } })
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!host.querySelector('[data-testid="area-toast"]'))
    expect(host.querySelector('[data-testid="area-toast"]')!.textContent).toContain('Plan your walk around where you are?')
    const details = host.querySelector('details.advanced') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('input[type="text"]')).not.toBeNull()
  })

  it('folds the planner to the route line once a route is planned, and folds the quest stats', async () => {
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    expect(host.querySelector('[data-testid="planner-toggle"]')).toBeNull()
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Start quest'))
    const planner = host.querySelector('[data-testid="planner"]')!
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="planner-toggle"]')!
    expect(planner.classList.contains('folded')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Edit')
    await act(async () => toggle.click())
    expect(planner.classList.contains('folded')).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // Planning again folds it back.
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => planner.classList.contains('folded'))
    await act(async () => button('Start quest')!.click())
    await waitFor(() => !!host.querySelector('[data-testid="hud-bottom"]'))
    const hud = host.querySelector('[data-testid="hud-bottom"]')!
    expect(hud.classList.contains('folded')).toBe(true)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="hud-fold"]')!.click())
    expect(hud.classList.contains('folded')).toBe(false)
  })
})
