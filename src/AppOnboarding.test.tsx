import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App.tsx'
import { ONBOARDING_STORAGE_KEY } from './config/brand.ts'
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

const intro = () => host.querySelector('[data-testid="onboarding"]')
const mount = async () => {
  const root = createRoot(host)
  await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
  return root
}

describe('App onboarding', () => {
  it('shows on the first run, stores the flag on Skip, and stays away afterwards', async () => {
    let root = await mount()
    expect(intro()).not.toBeNull()
    expect(host.querySelector('.logo svg')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="onb-skip"]')!.click())
    expect(intro()).toBeNull()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
    await act(async () => root.unmount())
    root = await mount()
    expect(intro()).toBeNull()
    await act(async () => root.unmount())
  })

  it('can be reopened from Settings with Show intro', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    const root = await mount()
    expect(intro()).toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="show-intro"]')!.click())
    expect(intro()).not.toBeNull()
    expect(host.querySelector('.onb-title')?.textContent).toBe('Choose your distance')
    await act(async () => root.unmount())
  })
})
