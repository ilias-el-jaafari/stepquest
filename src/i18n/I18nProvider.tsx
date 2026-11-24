import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseDemo } from '../demo/script.ts'
import { en, type MessageKey, type Translate } from './en.ts'
import { es } from './es.ts'
import { I18nContext } from './context.ts'
import { detectLocale, interpolate, persistLocale, type Locale } from './locale.ts'

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => (typeof location === 'undefined' ? undefined : parseDemo(location.search)?.lang) ?? detectLocale())

  // The page language, title and description follow the interface language.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    document.title = dictionaries[locale]['meta.title']
    document.head.querySelector('meta[name="description"]')?.setAttribute('content', dictionaries[locale]['meta.description'])
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
  }, [])

  const t = useCallback<Translate>(
    (key, ...args) => {
      const table = dictionaries[locale]
      return interpolate(table[key] ?? en[key] ?? key, args[0] as Record<string, string | number> | undefined, locale)
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
