import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { AudioEngine, setAudioEngineForTests } from './audio/engine.ts'
import { loadAudioSettings } from './audio/settings.ts'
import { I18nProvider } from './i18n/index.ts'
import { DEMO_AREA } from './osm/demoArea.ts'
import { loadDemoOsm } from './osm/demo.ts'
import { addStepsToday } from './quest/dailySteps.ts'
import { createQuest } from './quest/quest.ts'
import { QUEST_STORAGE_KEY, saveQuest } from './quest/storage.ts'
import { WalkGraph } from './routing/graph.ts'
import { planRoute } from './routing/planner.ts'
import { PlanClient } from './routing/planClient.ts'
import { OverpassClient } from './osm/overpass.ts'
import { loadDemoWorld } from './ui/useMapData.ts'

// Regression tests for the app shell review (task 67): each one failed before its fix.

vi.mock('./ui/useMapData.ts', async (original) => {
  const actual = await original<typeof import('./ui/useMapData.ts')>()
  return { ...actual, loadDemoWorld: vi.fn(actual.loadDemoWorld) }
})

// Counts every render of the map buttons, which only MapView draws (a proxy for "MapView rendered").
const renders = vi.hoisted(() => ({ plus: 0 }))
vi.mock('./ui/PixelIcons.tsx', async (original) => {
  const actual = await original<typeof import('./ui/PixelIcons.tsx')>()
  return {
    ...actual,
    PixelIcon: (props: Parameters<typeof actual.PixelIcon>[0]) => {
      if (props.name === 'plus') renders.plus++
      return actual.PixelIcon(props)
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
  vi.useRealTimers()
})

async function waitFor(check: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 50)))
  }
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
const render = () => act(async () => root.render(<I18nProvider><App /></I18nProvider>))
const ready = async () => {
  await render()
  await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
}

function demoRoute() {
  const r = planRoute(new WalkGraph(loadDemoOsm()), { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 10_000, strideM: 0.75 }, DEMO_AREA.bbox)
  if (!r.ok) throw new Error('route')
  return r.route
}

/** A plan request whose answer the test releases by hand. */
function deferredPlan() {
  const real = PlanClient.prototype.plan
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  const spy = vi.spyOn(PlanClient.prototype, 'plan').mockImplementation(async function (this: PlanClient, ...args) {
    await gate
    return real.apply(this, args)
  })
  return { spy, release: () => release() }
}

describe('planning', () => {
  it('B1: two taps on Plan quest in one frame send one request', async () => {
    await ready()
    const { spy, release } = deferredPlan()
    const plan = button('Plan quest')!
    await act(async () => {
      plan.click()
      plan.click()
    })
    expect(spy).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => !!button('Start quest'))
  })

  it('B2: a planner that throws does not leave the button stuck on "Planning…"', async () => {
    await ready()
    vi.spyOn(PlanClient.prototype, 'plan').mockRejectedValue(new Error('worker crashed'))
    await act(async () => button('Plan quest')!.click())
    await waitFor(() => !!button('Plan quest') && !button('Plan quest')!.disabled)
    expect(host.querySelector('[data-testid="plan-error"]')?.textContent).toMatch(/could not plan/i)
    expect(host.textContent).not.toContain('worker crashed')
  })

  it('B3: an answer that arrives after the user changed the mode is dropped', async () => {
    await ready()
    const { release } = deferredPlan()
    await act(async () => button('Plan quest')!.click())
    await act(async () => (host.querySelector('[role="radiogroup"] button:nth-child(2)') as HTMLButtonElement).click())
    release()
    await act(async () => new Promise((r) => setTimeout(r, 1500)))
    expect(host.querySelector('[data-testid="route-line"]')).toBeNull()
    expect(host.querySelector('[data-testid="steps"]')).toBeNull()
    expect(button('Plan quest')).toBeDefined()
    expect(button('Planning')).toBeUndefined()
  })
})

describe('start-up', () => {
  it('B4: a demo map that cannot load shows a retry instead of loading forever', async () => {
    vi.mocked(loadDemoWorld).mockRejectedValueOnce(new Error('chunk failed'))
    await render()
    await waitFor(() => !!host.querySelector('[data-testid="map-error"]'))
    expect(host.querySelector('[data-testid="map-error"]')?.textContent).not.toContain('chunk failed')
    await act(async () => (host.querySelector('[data-testid="map-retry"]') as HTMLButtonElement).click())
    await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
  })

  it('B5: a saved quest on a live map that cannot load tells the user and keeps the save', async () => {
    const q = createQuest(demoRoute(), { strideM: 0.75, area: { kind: 'live', bbox: DEMO_AREA.bbox }, simulated: true, now: Date.now(), sim: { timeScale: 1, noiseM: 0 } })
    saveQuest(q)
    vi.spyOn(OverpassClient.prototype, 'loadArea').mockRejectedValue(new Error('offline'))
    await render()
    await waitFor(() => !!host.querySelector('[data-testid="resume-failed"]'))
    expect(localStorage.getItem(QUEST_STORAGE_KEY)).not.toBeNull()
  })

  it('B6: steps today follow the clock when the app comes back to the foreground', async () => {
    await ready()
    expect(host.querySelector('[data-testid="steps-today"]')?.textContent).toContain('0')
    addStepsToday(4321, Date.now())
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(host.querySelector('[data-testid="steps-today"]')?.textContent).toContain('4,321')
  })
})

describe('re-render storms', () => {
  it('B7: typing in the step field does not redraw the map controls', async () => {
    await ready()
    const input = host.querySelector('input[name="steps"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const before = renders.plus
    for (const text of ['1', '12', '120', '1200', '12000']) {
      await act(async () => {
        set.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(renders.plus - before).toBeLessThanOrEqual(1)
  })

  it('B8: the quest clock tick does not redraw the map controls', async () => {
    const q = { ...createQuest(demoRoute(), { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: Date.now() }) }
    saveQuest(q)
    // Only intervals are faked, so the quest screen's one-second clock is ours to drive.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await render()
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    const before = renders.plus
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }
    expect(renders.plus - before).toBeLessThanOrEqual(1)
  })
})

describe('accessibility', () => {
  it('B9: every aria-label sits on an element that can carry one', async () => {
    await ready()
    await act(async () => (host.querySelector('[role="radiogroup"] button:nth-child(2)') as HTMLButtonElement).click())
    const bad = [...host.querySelectorAll('[aria-label]')].filter((el) => {
      const tag = el.tagName.toLowerCase()
      return !el.getAttribute('role') && !['button', 'input', 'select', 'textarea', 'a', 'nav', 'section', 'header', 'main', 'footer', 'aside', 'summary', 'ul', 'ol', 'table', 'form', 'svg'].includes(tag)
    })
    expect(bad.map((e) => e.outerHTML.slice(0, 80))).toEqual([])
  })

  it('B10: every aria-controls and aria-describedby points at an element that exists', async () => {
    await ready()
    const missing: string[] = []
    for (const el of host.querySelectorAll('[aria-controls], [aria-describedby]')) {
      for (const attr of ['aria-controls', 'aria-describedby']) {
        for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
          if (!host.querySelector(`[id="${id}"]`)) missing.push(`${el.tagName}.${attr}=${id}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('B11: Escape in the Info panel puts focus back on its button', async () => {
    await ready()
    await act(async () => (host.querySelector('[data-testid="tab-settings"]') as HTMLButtonElement).click())
    const toggle = host.querySelector('[data-testid="info-button"]') as HTMLButtonElement
    await act(async () => toggle.click())
    const close = host.querySelector('[data-testid="info-panel"] button') as HTMLButtonElement
    close.focus()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.querySelector('[data-testid="info-panel"]')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('B12: the quest finished screen is a named dialog that takes focus', async () => {
    const base = createQuest(demoRoute(), { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: Date.now(), sim: { timeScale: 1, noiseM: 0 } })
    saveQuest({ ...base, collected: base.route.checkpoints.length, finishedAt: Date.now(), alongM: base.route.distanceM })
    await render()
    await waitFor(() => !!host.querySelector('[data-testid="complete"]'))
    const dialog = host.querySelector('[data-testid="complete"] [role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(host.querySelector(`[id="${dialog.getAttribute('aria-labelledby')}"]`)?.textContent).toBe('Quest complete!')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('B13: ending a quest asks inside the app, not with the browser confirm box', async () => {
    const confirm = vi.fn(() => true)
    window.confirm = confirm
    saveQuest(createQuest(demoRoute(), { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: Date.now(), sim: { timeScale: 1, noiseM: 0 } }))
    await render()
    await waitFor(() => !!host.querySelector('[data-testid="hud"]'))
    await act(async () => button('End')!.click())
    expect(confirm).not.toHaveBeenCalled()
    const dialog = host.querySelector('[data-testid="confirm-end"]') as HTMLElement
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Cancel keeps the quest; confirming leaves it.
    await act(async () => (host.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="hud"]')).not.toBeNull()
    await act(async () => button('End')!.click())
    await act(async () => (host.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click())
    await waitFor(() => !host.querySelector('[data-testid="hud"]'))
  })

  it('B15: a modal intro makes the app behind it inert and Escape works from anywhere', async () => {
    localStorage.removeItem('stepquest.onboarded')
    await render()
    expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.querySelector('[data-testid="onboarding"]')).toBeNull()
    expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(false)
  })

  it('B16: presets and the place buttons tell assistive tech which one is on', async () => {
    await ready()
    const presets = [...host.querySelectorAll('.presets button')]
    expect(presets.every((b) => b.hasAttribute('aria-pressed'))).toBe(true)
    expect(presets.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['10k'])
  })
})

describe('network and updates', () => {
  it('shows an offline note while the browser is offline, and removes it when it is back', async () => {
    await ready()
    expect(host.querySelector('[data-testid="offline"]')).toBeNull()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => void window.dispatchEvent(new Event('offline')))
    expect(host.querySelector('[data-testid="offline"]')?.textContent).toContain('offline')
    online.mockReturnValue(true)
    await act(async () => void window.dispatchEvent(new Event('online')))
    expect(host.querySelector('[data-testid="offline"]')).toBeNull()
  })
})
