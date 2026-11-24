import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_NAME } from '../config/brand.ts'
import { en } from './en.ts'
import { es } from './es.ts'
import { I18nProvider } from './I18nProvider.tsx'
import { useI18n } from './context.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

function Probe() {
  const { t, locale, setLocale } = useI18n()
  return (
    <>
      <p data-testid="out">{t('result.short', { km: '1,00 km', steps: '1', n: 1 })}</p>
      <button type="button" data-testid="switch" onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}>
        switch
      </button>
    </>
  )
}

const description = () => document.head.querySelector('meta[name="description"]')?.getAttribute('content')

let host: HTMLDivElement
let root: Root
const out = () => host.querySelector('[data-testid="out"]')!.textContent
const flip = () => act(() => (host.querySelector('[data-testid="switch"]') as HTMLButtonElement).click())

describe('I18nProvider', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    localStorage.clear()
    document.head.innerHTML = '<meta name="description" content="x">'
    document.documentElement.lang = 'en'
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('keeps html lang, title and description in step with the language, both ways', () => {
    act(() =>
      root.render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      ),
    )
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe(en['meta.title'])
    expect(description()).toBe(en['meta.description'])
    flip()
    expect(document.documentElement.lang).toBe('es')
    expect(document.title).toBe(es['meta.title'])
    expect(description()).toBe(es['meta.description'])
    expect(out()).toContain('paso')
    flip()
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe(en['meta.title'])
  })

  it('names the product in the title in both languages', () => {
    expect(en['meta.title']).toContain(APP_NAME)
    expect(es['meta.title']).toContain(APP_NAME)
  })
})
