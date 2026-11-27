import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ONBOARDING_STORAGE_KEY } from '../config/brand.ts'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { I18nProvider } from '../i18n/index.ts'
import { Onboarding } from './Onboarding.tsx'
import { LOGO, logoSvg } from './logoArt.ts'
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding.ts'
import type { Icon } from './pixelArt.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
let closed = 0

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  closed = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function show(locale: 'en' | 'es' = 'en') {
  localStorage.setItem('stepquest.locale', locale)
  await act(async () =>
    root.render(
      <I18nProvider>
        <button type="button" id="opener">
          open
        </button>
        <Onboarding onClose={() => (closed += 1)} />
      </I18nProvider>,
    ),
  )
}

const q = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!
const title = () => host.querySelector('.onb-title')?.textContent
const key = async (k: string, target: Element = dialog()) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
const click = async (id: string) => act(async () => q(id)!.click())

describe('Onboarding', () => {
  it('is a labelled modal dialog with focus inside', async () => {
    await show()
    const d = dialog()
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector(`#${CSS.escape(d.getAttribute('aria-labelledby')!)}`)?.textContent).toBe(en['onboarding.1.title'])
    expect(document.activeElement).toBe(d)
  })

  it('walks through exactly three screens with Next and Back, then Start', async () => {
    await show()
    expect(title()).toBe(en['onboarding.1.title'])
    expect(q('onb-back')).toBeNull()
    expect(q('onb-next')!.textContent).toBe(en['onboarding.next'])
    await click('onb-next')
    expect(title()).toBe(en['onboarding.2.title'])
    await click('onb-next')
    expect(title()).toBe(en['onboarding.3.title'])
    expect(q('onb-next')!.textContent).toBe(en['onboarding.start'])
    await click('onb-back')
    expect(title()).toBe(en['onboarding.2.title'])
    await click('onb-next')
    expect(closed).toBe(0)
    await click('onb-next')
    expect(closed).toBe(1)
  })

  it('skips with the button and with Escape, on any screen', async () => {
    await show()
    await click('onb-skip')
    expect(closed).toBe(1)
    await key('Escape')
    expect(closed).toBe(2)
  })

  it('moves with the arrow keys and Enter on the panel', async () => {
    await show()
    await key('ArrowRight')
    expect(title()).toBe(en['onboarding.2.title'])
    await key('ArrowLeft')
    expect(title()).toBe(en['onboarding.1.title'])
    await key('Enter')
    await key('Enter')
    expect(title()).toBe(en['onboarding.3.title'])
    await key('ArrowRight')
    expect(title()).toBe(en['onboarding.3.title'])
    await key('Enter')
    expect(closed).toBe(1)
  })

  it('does not double-handle Enter on a button', async () => {
    await show()
    await key('Enter', q('onb-next')!)
    expect(title()).toBe(en['onboarding.1.title'])
  })

  it('keeps Tab inside the dialog', async () => {
    await show()
    q('onb-next')!.focus()
    await key('Tab', q('onb-next')!)
    expect(document.activeElement).toBe(q('onb-skip'))
    await key('Tab', dialog()) // forward from the panel is native
    q('onb-skip')!.focus()
    await act(async () => {
      q('onb-skip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(q('onb-next'))
  })

  it('restores focus when it closes', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    await show()
    expect(document.activeElement).toBe(dialog())
    await act(async () => root.render(<I18nProvider>{null}</I18nProvider>))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('follows the app language', async () => {
    await show('es')
    expect(title()).toBe(es['onboarding.1.title'])
    expect(host.querySelector('.onb-step')?.textContent).toBe('Paso 1 de 3')
    expect(q('onb-skip')!.textContent).toBe(es['onboarding.skip'])
  })
})

describe('onboarding flag', () => {
  it('is unset at first, then stored under the brand key', () => {
    expect(hasSeenOnboarding()).toBe(false)
    markOnboardingSeen()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('1')
    expect(hasSeenOnboarding()).toBe(true)
  })
})

describe('logo and illustrations', () => {
  const rectangular = (a: Icon) => {
    const w = a.rows[0]!.length
    for (const r of a.rows) expect(r.length).toBe(w)
    for (const ch of new Set(a.rows.join(''))) if (ch !== '.') expect(a.colors[ch], ch).toBeDefined()
  }
  it('are rectangular and use only declared colours', () => {
    rectangular(LOGO)
    expect(LOGO.rows).toHaveLength(16)
  })
  it('builds a favicon with rects only', () => {
    const svg = logoSvg()
    expect(svg).toContain('<rect')
    expect(svg).not.toMatch(/<image|<text|font/)
  })
})
