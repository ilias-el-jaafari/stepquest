import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { InfoMenu } from './InfoMenu.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
const VALENCIA = { lat: 39.4935, lon: -0.392 }
const NOW = Date.UTC(2026, 10, 22, 12)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function open(locale: 'en' | 'es') {
  localStorage.setItem('stepquest.locale', locale)
  await act(async () => root.render(<I18nProvider><InfoMenu place={VALENCIA} now={NOW} /></I18nProvider>))
  expect(host.querySelector('[data-testid="info-panel"]')).toBeNull()
  await act(async () => (host.querySelector('[data-testid="info-button"]') as HTMLButtonElement).click())
  return host.querySelector('[data-testid="info-panel"]')!
}

describe('InfoMenu', () => {
  it('explains safe routes, night and the avoid list in English', async () => {
    const panel = await open('en')
    expect(panel.querySelectorAll('dt')).toHaveLength(5)
    expect(panel.textContent).toContain('Are the routes safe?')
    expect(panel.textContent).toContain('From sunset to sunrise')
    expect(panel.textContent).toContain('not crime data')
    expect(panel.textContent).toMatch(/sunrise \d{2}:\d{2}.*sunset \d{2}:\d{2}/)
  })
  it('speaks Spanish and closes with the button or Escape', async () => {
    const panel = await open('es')
    expect(panel.textContent).toContain('¿Son seguras las rutas?')
    expect(panel.textContent).toContain('puesta de sol')
    await act(async () => (panel.querySelector('button[aria-label="Cerrar"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="info-panel"]')).toBeNull()
    await act(async () => (host.querySelector('[data-testid="info-button"]') as HTMLButtonElement).click())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[data-testid="info-panel"]')).toBeNull()
  })
})
