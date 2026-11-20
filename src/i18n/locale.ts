import { LOCALE_STORAGE_KEY } from '../config/brand.ts'
import { en } from './en.ts'

export type Locale = 'en' | 'es'

export function readStoredLocale(): Locale | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Privacy mode may block storage.
  }
  return undefined
}

export function detectLocale(
  language: string | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.language,
): Locale {
  const stored = readStoredLocale()
  if (stored) return stored
  const code = language?.toLowerCase() ?? ''
  return code.startsWith('es') ? 'es' : 'en'
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  )
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage failures.
  }
}

export { en }
