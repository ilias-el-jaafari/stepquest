import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './en.ts'
import { es } from './es.ts'
import { I18nContext } from './context.ts'
import { detectLocale, interpolate, persistLocale, type Locale } from './locale.ts'

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, es }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale())

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
    if (typeof document !== 'undefined') document.documentElement.lang = next
  }, [])

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const table = dictionaries[locale]
      return interpolate(table[key] ?? en[key] ?? key, vars, locale)
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
