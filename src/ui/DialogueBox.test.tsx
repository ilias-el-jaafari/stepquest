import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { DialogueBox } from './DialogueBox.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('stepquest.locale', 'en')
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const box = () => host.querySelector<HTMLElement>('.dialog')!
const typed = () => host.querySelector('.dialog-text')!.firstChild?.textContent ?? ''

describe('DialogueBox', () => {
  it('types the text out, then shows the "more" marker', async () => {
    await act(async () => root.render(<I18nProvider><DialogueBox kind="start" lines={['Hello walker!']} onDone={() => {}} charMs={10} /></I18nProvider>))
    expect(box().dataset.kind).toBe('start')
    expect(host.querySelector('.dialog-more')).toBeNull()
    // Each character is its own timer tick after a render.
    for (let i = 0; i < 4; i++) await act(async () => vi.advanceTimersByTime(10))
    expect(typed().length).toBeGreaterThan(0)
    expect(typed().length).toBeLessThan('Hello walker!'.length)
    for (let i = 0; i < 20; i++) await act(async () => vi.advanceTimersByTime(10))
    expect(host.querySelector('.dialog-text')!.textContent).toBe('Hello walker!')
    expect(host.querySelector('.dialog-more.last')).not.toBeNull()
  })

  it('skips typing on the first tap, moves to the next line on the second, and closes after the last', async () => {
    const done = vi.fn()
    await act(async () => root.render(<I18nProvider><DialogueBox kind="finish" lines={['One', 'Two']} onDone={done} charMs={50} /></I18nProvider>))
    await act(async () => box().click())
    expect(typed()).toBe('One')
    expect(host.querySelector('.dialog-more:not(.last)')).not.toBeNull()
    await act(async () => box().click())
    await act(async () => box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(typed()).toBe('Two')
    expect(done).not.toHaveBeenCalled()
    await act(async () => box().click())
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('closes by itself after the last line when auto-close is set', async () => {
    const done = vi.fn()
    await act(async () => root.render(<I18nProvider><DialogueBox kind="pickup" lines={['Gem 1/3!']} onDone={done} autoCloseMs={2000} charMs={0} /></I18nProvider>))
    expect(typed()).toBe('Gem 1/3!')
    await act(async () => vi.advanceTimersByTime(1900))
    expect(done).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(200))
    expect(done).toHaveBeenCalledTimes(1)
  })
})
