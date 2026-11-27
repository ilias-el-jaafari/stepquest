import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
let broken = true

function Bomb() {
  if (broken) throw new Error('secret internal detail')
  return <p data-testid="fine">fine</p>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  broken = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const show = () => act(async () => root.render(<ErrorBoundary><Bomb /></ErrorBoundary>))

describe('ErrorBoundary', () => {
  it('shows a friendly English message instead of a white screen, without the raw error', async () => {
    localStorage.setItem('stepquest.locale', 'en')
    await show()
    const crash = host.querySelector('[data-testid="crash"]')!
    expect(crash.getAttribute('role')).toBe('alert')
    expect(crash.textContent).toContain(en['crash.title'])
    expect(crash.textContent).toContain('saved quest and settings are safe')
    expect(crash.textContent).not.toContain('secret internal detail')
  })

  it('speaks Spanish when the language is Spanish', async () => {
    localStorage.setItem('stepquest.locale', 'es')
    await show()
    expect(host.textContent).toContain(es['crash.title'])
    expect(host.textContent).toContain('Recargar')
  })

  it('"Try again" renders the children again, and keeps the saved data', async () => {
    localStorage.setItem('stepquest.locale', 'en')
    localStorage.setItem('stepquest.quest', '{"keep":"me"}')
    await show()
    broken = false
    await act(async () => (host.querySelector('[data-testid="crash-retry"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="fine"]')).not.toBeNull()
    expect(localStorage.getItem('stepquest.quest')).toBe('{"keep":"me"}')
  })

  it('"Reload" reloads the page', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await show()
    await act(async () => (host.querySelector('[data-testid="crash-reload"]') as HTMLButtonElement).click())
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
