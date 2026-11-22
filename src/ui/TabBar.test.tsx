import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { ICONS } from './pixelArt.ts'
import { TabBar } from './TabBar.tsx'
import { TABS, type Tab } from './tabs.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

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

function Harness() {
  const [tab, setTab] = useState<Tab>('map')
  return <TabBar tab={tab} onTab={setTab} />
}

const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
const selected = () => tabs().find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.testid

describe('TabBar', () => {
  it('shows four tabs with icons and English labels, the map selected', async () => {
    await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>))
    expect(tabs().map((b) => b.textContent)).toEqual(['Map', 'Bag', 'Hero', 'Settings'])
    expect(host.querySelectorAll('svg.pixel-icon')).toHaveLength(4)
    expect(selected()).toBe('tab-map')
    expect(tabs().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1])
    expect(tabs()[1]!.getAttribute('aria-controls')).toBe('tabpanel-bag')
  })
  it('switches by click and with the arrow keys, wrapping round', async () => {
    await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>))
    await act(async () => tabs()[2]!.click())
    expect(selected()).toBe('tab-hero')
    const list = host.querySelector('[role="tablist"]')!
    await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(selected()).toBe('tab-settings')
    await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(selected()).toBe('tab-map')
    await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(selected()).toBe('tab-settings')
  })
  it('speaks Spanish', async () => {
    localStorage.setItem('stepquest.locale', 'es')
    await act(async () => root.render(<I18nProvider><Harness /></I18nProvider>))
    expect(tabs().map((b) => b.textContent)).toEqual(['Mapa', 'Mochila', 'Héroe', 'Ajustes'])
    expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe('Menú principal')
  })
})

describe('pixel icons', () => {
  it('has an icon for every tab, 12×12, with every pixel letter coloured', () => {
    for (const tab of TABS) expect(ICONS[tab]).toBeDefined()
    for (const [name, icon] of Object.entries(ICONS)) {
      expect(icon.rows, name).toHaveLength(12)
      for (const row of icon.rows) {
        expect(row, name).toHaveLength(12)
        for (const ch of row) if (ch !== '.') expect(icon.colors[ch as keyof typeof icon.colors], `${name} ${ch}`).toBeDefined()
      }
    }
  })
})
