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

/** First supported language of a browser preference list (`navigator.languages`), else English. */
export function detectLocale(
  languages: string | readonly string[] | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.languages?.length
      ? navigator.languages
      : navigator.language,
): Locale {
  const stored = readStoredLocale()
  if (stored) return stored
  for (const language of typeof languages === 'string' ? [languages] : (languages ?? [])) {
    const primary = language.toLowerCase().split(/[-_]/)[0]
    if (primary === 'es') return 'es'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

const GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/

/**
 * Number behind a variable. Formatted strings count by their value: "10.000" and
 * "1,234" are grouped thousands, "0,01" and "1.5" are fractions.
 */
function countOf(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  const text = (value ?? '').trim().replace('−', '-')
  const unsigned = text.replace(/^-/, '')
  if (/^\d+$/.test(unsigned)) return Number(text)
  if (GROUPED.test(unsigned)) return Number(text.replace(/[.,]/g, ''))
  if (/^\d+[.,]\d+$/.test(unsigned)) return Number(text.replace(',', '.'))
  return Number.NaN
}

const pluralRules = new Map<Locale, Intl.PluralRules>()
function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale)
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)))
  return rules
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
  const rules = rulesFor(locale)
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
