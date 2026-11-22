import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App.tsx'
import { SETTINGS_STORAGE_KEY } from './config/brand.ts'
import { I18nProvider } from './i18n/index.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function waitFor(check: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 50)))
  }
}

const stepsInput = () => host.querySelector<HTMLInputElement>('input[name="steps"]')!
const strideInput = () => host.querySelector<HTMLInputElement>('input[name="stride"]')!
const slider = () => host.querySelector<HTMLInputElement>('input[type="range"]')!
const note = (id: string) => host.querySelector(`#${id}`)?.textContent ?? ''
const kmHint = () => host.querySelector('[data-testid="km-hint"]')?.textContent ?? ''
const savedSettings = () => JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as { targetSteps?: number; strideM?: number }

/** Set the value like a browser does (so React's value tracker sees it) and fire an input event. */
async function setValue(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Type text one character at a time on top of the current value. */
async function typeChars(el: HTMLInputElement, text: string) {
  for (const ch of text) await setValue(el, el.value + ch)
}

async function blur(el: HTMLInputElement) {
  await act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

async function pressEnter(el: HTMLInputElement) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('step goal and stride inputs', () => {
  it('lets you type 2000 one character at a time', async () => {
    await setValue(stepsInput(), '')
    const seen: string[] = []
    for (const ch of '2000') {
      await typeChars(stepsInput(), ch)
      seen.push(stepsInput().value)
    }
    expect(seen).toEqual(['2', '20', '200', '2000'])
    // Below the minimum while typing: a range hint, but nothing is reset.
    expect(savedSettings().targetSteps).toBe(2000)
    expect(slider().value).toBe('2000')
    expect(kmHint()).toContain('2,000 steps')
    await blur(stepsInput())
    expect(stepsInput().value).toBe('2000')
    expect(note('steps-note')).toBe('')
  })

  it('shows a range hint while typing and keeps the partial value', async () => {
    await setValue(stepsInput(), '2')
    expect(stepsInput().value).toBe('2')
    expect(note('steps-note')).toContain('Allowed: 100–60,000 steps')
    expect(stepsInput().getAttribute('aria-invalid')).toBe('true')
    expect(savedSettings().targetSteps).toBe(10_000)
  })

  it('clamps on blur with an inline note', async () => {
    await setValue(stepsInput(), '20')
    await blur(stepsInput())
    expect(stepsInput().value).toBe('100')
    expect(note('steps-note')).toContain('Set to 100 steps')
    expect(savedSettings().targetSteps).toBe(100)

    await setValue(stepsInput(), '90000')
    await blur(stepsInput())
    expect(stepsInput().value).toBe('60000')
    expect(note('steps-note')).toContain('Set to 60,000 steps')
  })

  it('clamps on Enter and keeps the old goal for garbage', async () => {
    await setValue(stepsInput(), '5')
    await pressEnter(stepsInput())
    expect(stepsInput().value).toBe('100')
    await setValue(stepsInput(), 'lots')
    await blur(stepsInput())
    expect(stepsInput().value).toBe('100')
    expect(note('steps-note')).toContain('whole number')
  })

  it('keeps the slider and the typed value in sync both ways', async () => {
    await setValue(slider(), '4500')
    expect(stepsInput().value).toBe('4500')
    expect(savedSettings().targetSteps).toBe(4500)

    await setValue(stepsInput(), '12000')
    expect(slider().value).toBe('12000')

    // Typed values outside the slider range are allowed; the slider pins to its end.
    await setValue(stepsInput(), '45000')
    await blur(stepsInput())
    expect(stepsInput().value).toBe('45000')
    expect(savedSettings().targetSteps).toBe(45_000)
    expect(slider().value).toBe('30000')
    await setValue(stepsInput(), '300')
    expect(slider().value).toBe('500')
    expect(savedSettings().targetSteps).toBe(300)
  })

  it('presets update the field and the slider', async () => {
    const chip = [...host.querySelectorAll('button')].find((b) => b.textContent === '8k')!
    await act(async () => chip.click())
    expect(stepsInput().value).toBe('8000')
    expect(slider().value).toBe('8000')
  })

  it('lets you type a stride freely, with a decimal comma, and clamps on blur', async () => {
    await setValue(strideInput(), '')
    await typeChars(strideInput(), '0,82')
    expect(strideInput().value).toBe('0,82')
    expect(savedSettings().strideM).toBe(0.82)
    await blur(strideInput())
    expect(strideInput().value).toBe('0.82')

    await setValue(strideInput(), '')
    await typeChars(strideInput(), '2')
    expect(strideInput().value).toBe('2')
    expect(note('stride-note')).toContain('Allowed: 0.4–1.2 m')
    await blur(strideInput())
    expect(strideInput().value).toBe('1.2')
    expect(note('stride-note')).toContain('Set to 1.2 m')
    expect(savedSettings().strideM).toBe(1.2)
  })

  it('Plan uses the typed value even without blur, and clamps it first', async () => {
    await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
    await setValue(stepsInput(), '')
    await typeChars(stepsInput(), '3000')
    const plan = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Plan quest')!
    await act(async () => plan.click())
    await waitFor(() => !!host.querySelector('[data-testid="steps"]'))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 3000)).toBeLessThanOrEqual(150)

    await setValue(stepsInput(), '7')
    const plan2 = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Plan quest')!
    await act(async () => plan2.click())
    expect(stepsInput().value).toBe('100')
    expect(note('steps-note')).toContain('Set to 100 steps')
  })
})
