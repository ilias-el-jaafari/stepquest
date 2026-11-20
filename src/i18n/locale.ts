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

/** Number behind a variable (formatted strings like "10.000" or "1,234" count by their digits). */
function countOf(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  const digits = (value ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : Number.NaN
}

/**
 * Fill `{name}` placeholders. Plurals use `{name|one|other}`: the form is
 * chosen with the locale's plural rules for the value of `name`, and `#`
 * inside a form is replaced by that value, e.g. `{n|# checkpoint|# checkpoints}`.
 */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
  locale: Locale = 'en',
): string {
  if (!vars) return template
  const rules = new Intl.PluralRules(locale)
  return template.replace(/\{(\w+)(?:\|([^{}|]*)\|([^{}]*))?\}/g, (match, name: string, one?: string, other?: string) => {
    if (!Object.hasOwn(vars, name)) return match
    const value = vars[name]!
    if (one === undefined || other === undefined) return String(value)
    const n = countOf(value)
    const form = Number.isFinite(n) && rules.select(n) === 'one' ? one : other
    return form.replaceAll('#', String(value))
  })
}

export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage failures.
  }
}

export { en }
