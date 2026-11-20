import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App.tsx'
import { APP_NAME } from './config/brand.ts'
import { I18nProvider } from './i18n/index.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => host.remove())

async function waitFor(check: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await act(async () => new Promise((r) => setTimeout(r, 50)))
  }
}

describe('App', () => {
  it('loads the demo map, plans a 10k loop and shows the quest log', async () => {
    const root = createRoot(host)
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    expect(host.querySelector('h1')?.textContent).toBe(APP_NAME)
    await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
    const plan = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Plan quest')!
    expect(plan.disabled).toBe(false)
    await act(async () => plan.click())
    await waitFor(() => !!host.querySelector('[data-testid="steps"]'))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 10_000)).toBeLessThanOrEqual(500)
    expect(host.querySelector('[data-testid="feasibility"]')?.textContent).toContain('Route ready')
    await act(async () => root.unmount())
  })

  it('switches to Spanish', async () => {
    const root = createRoot(host)
    await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
    const select = host.querySelector('select')!
    await act(async () => {
      select.value = 'es'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.textContent).toContain('Planear misión')
    await act(async () => root.unmount())
  })
})
