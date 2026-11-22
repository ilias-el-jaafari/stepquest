import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLookForTests } from '../hero/useLook.ts'
import { LOOK_STORAGE_KEY } from '../hero/look.ts'
import { I18nProvider } from '../i18n/index.ts'
import { HeroEditor } from './HeroEditor.tsx'
import { filledSegments } from './meterSegments.ts'
import { canVibrate, installPressFeedback } from './pressFeedback.ts'
import { StepMeter } from './StepMeter.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  resetLookForTests()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('press feedback', () => {
  const press = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }))

  it('clicks once per press on buttons, tabs and radios, not on plain text or disabled buttons', () => {
    host.innerHTML = '<button id="b"><span id="inner">Go</span></button><button id="off" disabled>No</button><div role="tab" id="t">Tab</div><p id="p">Text</p>'
    const playClick = vi.fn()
    const stop = installPressFeedback(document, { playClick })
    press(host.querySelector('#inner')!)
    press(host.querySelector('#t')!)
    press(host.querySelector('#p')!)
    press(host.querySelector('#off')!)
    expect(playClick).toHaveBeenCalledTimes(2)
    stop()
    press(host.querySelector('#b')!)
    expect(playClick).toHaveBeenCalledTimes(2)
  })

  it('buzzes briefly on Android only', () => {
    host.innerHTML = '<button id="b">Go</button>'
    const vibrate = vi.fn(() => true)
    const android = installPressFeedback(document, { playClick: () => {}, vibrate, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })
    press(host.querySelector('#b')!)
    android()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate.mock.calls[0]).toEqual([8])
    const iphone = installPressFeedback(document, { playClick: () => {}, vibrate, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    press(host.querySelector('#b')!)
    iphone()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(canVibrate({ userAgent: 'Android', vibrate: () => true })).toBe(true)
    expect(canVibrate({ userAgent: 'Android' })).toBe(false)
    expect(canVibrate({ userAgent: 'iPhone', vibrate: () => true })).toBe(false)
  })
})

describe('step meter', () => {
  it('fills one of ten segments per tenth of the goal', async () => {
    expect([0, 9, 10, 55, 100, 250, Number.NaN].map((p) => filledSegments(p))).toEqual([0, 0, 1, 5, 10, 10, 0])
    await act(async () => root.render(<StepMeter pct={42} label="42%" />))
    const meter = host.querySelector('[data-testid="step-meter"]')!
    expect(meter.getAttribute('role')).toBe('progressbar')
    expect(meter.getAttribute('aria-valuenow')).toBe('42')
    expect(meter.querySelectorAll('.seg')).toHaveLength(10)
    expect(meter.querySelectorAll('.seg.on')).toHaveLength(4)
  })
})

describe('hero editor', () => {
  it('changes the body and colours, shows them in the preview and saves them', async () => {
    await act(async () => root.render(<I18nProvider><HeroEditor /></I18nProvider>))
    const radios = (testid: string) => [...host.querySelectorAll<HTMLButtonElement>(`[data-testid="${testid}"] [role="radio"]`)]
    expect(radios('swatches-shirt').length).toBeGreaterThanOrEqual(6)
    expect(radios('swatches-shirt')[0]!.getAttribute('aria-checked')).toBe('true')
    expect(radios('swatches-shirt')[2]!.getAttribute('aria-label')).toBe('Shirt: colour 3')
    const before = host.querySelector('[data-testid="walker-preview"]')!.innerHTML
    await act(async () => radios('swatches-shirt')[2]!.click())
    expect(radios('swatches-shirt')[2]!.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[data-testid="walker-preview"]')!.innerHTML).not.toBe(before)
    const girl = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === 'Girl')!
    await act(async () => girl.click())
    expect(girl.getAttribute('aria-checked')).toBe('true')
    expect(JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY)!)).toMatchObject({ body: 'girl', shirt: 2 })
  })
})
