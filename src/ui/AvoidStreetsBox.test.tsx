import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { AvoidStreetsBox } from './AvoidStreetsBox.tsx'

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
})

const streets = ['Calle de Burjassot', 'Plaza de Burjassot', 'Avenida de la Constitución']

async function render(over: Partial<Parameters<typeof AvoidStreetsBox>[0]> = {}) {
  const props = {
    avoid: [] as string[],
    onAvoid: vi.fn(),
    onUnavoid: vi.fn(),
    streets,
    picking: false,
    onPick: vi.fn(),
    ...over,
  }
  await act(async () => root.render(<I18nProvider><AvoidStreetsBox {...props} /></I18nProvider>))
  return props
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text) || b.getAttribute('aria-label')?.includes(text))

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('AvoidStreetsBox', () => {
  it('has no safe-route or night switches (always on)', async () => {
    await render()
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(host.textContent).not.toMatch(/safe|sunset|night/i)
  })
  it('searches street names and adds one to the avoid list', async () => {
    const p = await render()
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    await type(search, 'burja')
    expect(button('Avoid Calle de Burjassot')).toBeDefined()
    expect(button('Avoid Plaza de Burjassot')).toBeDefined()
    await act(async () => button('Avoid Calle de Burjassot')!.click())
    expect(p.onAvoid).toHaveBeenCalledWith('Calle de Burjassot')
    await type(search, 'nowhere')
    expect(host.textContent).toContain('No street with that name')
  })
  it('lists avoided streets with remove buttons and a plural count', async () => {
    const p = await render({ avoid: ['Calle de Burjassot', 'Camino Lejano'] })
    expect(host.textContent).toContain('2 streets avoided.')
    expect(host.textContent).toContain('Striped on the map.')
    expect(host.querySelector('.hazard-swatch')).not.toBeNull()
    expect(host.textContent).toContain('Not in this area')
    await act(async () => button('Stop avoiding Calle de Burjassot')!.click())
    expect(p.onUnavoid).toHaveBeenCalledWith('Calle de Burjassot')
    await render({ avoid: ['Calle de Burjassot'] })
    expect(host.textContent).toContain('1 street avoided.')
  })
  it('enters and reports map picking', async () => {
    const p = await render()
    await act(async () => button('Pick on map')!.click())
    expect(p.onPick).toHaveBeenCalledWith(true)
    await render({ picking: true, pickNote: { ok: false } })
    expect(host.textContent).toContain('Tap a street on the map')
    expect(host.textContent).toContain('No named street there')
  })
  it('speaks Spanish', async () => {
    localStorage.setItem('stepquest.locale', 'es')
    await act(async () => root.unmount())
    root = createRoot(host)
    await render({ avoid: ['Calle de Burjassot'] })
    expect(host.textContent).toContain('Calles a evitar')
    expect(host.textContent).toContain('1 calle evitada.')
  })
})
