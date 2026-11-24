import { createContext, useContext, type ReactNode } from 'react'
import type { Translate } from './en.ts'
import type { Locale } from './locale.ts'

export type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}

export type { ReactNode }
