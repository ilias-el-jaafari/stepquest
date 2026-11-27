import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { MapBanners } from './MapBanners.tsx'

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

const base = { picking: false, noStreet: false, loading: undefined, outsideView: false, askHere: false, errorCode: undefined, onCancelPick: () => {}, onLoadView: () => {}, onLocate: () => {}, onDismissAsk: () => {} }

async function show(locale: 'en' | 'es', finish?: { name?: string }) {
  // The language is read when the provider mounts, so every call mounts a fresh one.
  await act(async () => root.unmount())
  root = createRoot(host)
  localStorage.setItem('stepquest.locale', locale)
  await act(async () =>
    root.render(
      <I18nProvider>
        <MapBanners {...base} finish={finish} />
      </I18nProvider>,
    ),
  )
  return host.querySelector('[data-testid="finish-note"]')?.textContent
}

describe('finish street note (requirement 25.7)', () => {
  it('says "Finish: Calle X" in English and "Meta: Calle X" in Spanish, with the name as the data has it', async () => {
    expect(await show('en', { name: 'Calle Mayor' })).toBe('Finish: Calle Mayor')
    expect(await show('es', { name: 'Carrer de Pare Lluís' })).toBe('Meta: Carrer de Pare Lluís')
  })

  it('names a street without a name plainly, and shows nothing without a snap', async () => {
    expect(await show('en', {})).toBe('Finish: street')
    expect(await show('es', {})).toBe('Meta: calle')
    expect(await show('en', undefined)).toBeUndefined()
  })

  it('is a status line, so a screen reader hears it', async () => {
    await show('en', { name: 'X' })
    expect(host.querySelector('[data-testid="finish-note"]')?.getAttribute('role')).toBe('status')
  })
})
