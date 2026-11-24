import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { en, type MessageKey } from './en.ts'
import { es } from './es.ts'
import { formatDecimal, formatNumber } from './format.ts'
import { interpolate, type Locale } from './locale.ts'

const SEED = 20261204
const tables: [Locale, Record<string, string>][] = [
  ['en', en],
  ['es', es],
]
const keys = Object.keys(en) as MessageKey[]

/** Every `{name}` and `{name|one|other}` in a template. */
const PLACEHOLDER = /\{(\w+)(?:\|([^{}|]*)\|([^{}]*))?\}/g
const names = (s: string) => [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort()
const pluralNames = (s: string) => [...new Set([...s.matchAll(PLACEHOLDER)].filter((m) => m[2] !== undefined).map((m) => m[1]!))].sort()

describe('i18n properties', () => {
  it('P-I1: every EN key has an ES twin with the same placeholder names and plural forms (exhaustive)', () => {
    expect(Object.keys(es).sort()).toEqual([...keys].sort())
    for (const key of keys) {
      expect(names((es as Record<string, string>)[key]!), `${key}: placeholder names`).toEqual(names(en[key]))
      expect(pluralNames((es as Record<string, string>)[key]!), `${key}: plural placeholders`).toEqual(pluralNames(en[key]))
    }
  })

  it('P-I1: no template has stray braces outside the placeholder syntax', () => {
    for (const [locale, table] of tables) {
      for (const key of keys) {
        const rest = table[key]!.replace(PLACEHOLDER, '')
        expect(rest, `${locale} ${key}`).not.toMatch(/[{}]/)
      }
    }
  })

  it('P-I2: interpolation never throws and never leaves a supplied {placeholder} unfilled, in both languages', () => {
    const allNames = [...new Set(keys.flatMap((k) => [...names(en[k]), ...names((es as Record<string, string>)[k]!)]))]
    // Values: counts (including odd ones), formatted numbers, and free text without template syntax.
    const valueArb = fc.oneof(
      fc.integer({ min: -5, max: 1_000_000 }),
      fc.double({ noNaN: false }),
      fc.integer({ min: 0, max: 100_000 }).map((n) => n.toLocaleString('es-ES')),
      fc.string({ unit: fc.constantFrom(...'abc XYZ$&#.,0123456789áñ'.split('')), maxLength: 12 }),
    )
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...allNames), valueArb, { minKeys: allNames.length, maxKeys: allNames.length }), (vars) => {
        for (const [locale, table] of tables) {
          for (const key of keys) {
            const out = interpolate(table[key]!, vars, locale)
            expect(out, `${locale} ${key}`).not.toMatch(/\{\w+(\|[^{}]*)?\}/)
            expect(typeof out).toBe('string')
          }
        }
      }),
      { seed: SEED, numRuns: 100 },
    )
  })

  it('P-I2: a plural form is picked by the count and `#` is replaced by the value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.constantFrom<Locale>('en', 'es'), (n, locale) => {
        const out = interpolate('{n|# uno|# otros}', { n }, locale)
        expect(out).toBe(n === 1 ? '1 uno' : `${n} otros`)
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('P-I2: missing variables leave only the missing placeholders behind', () => {
    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.constantFrom<Locale>('en', 'es'), fc.integer({ min: 0, max: 50 }), (key, locale, n) => {
        const table = locale === 'en' ? en : (es as Record<string, string>)
        const template = table[key]!
        const out = interpolate(template, { n }, locale)
        expect(names(out).every((name) => name !== 'n')).toBe(true)
        expect(names(out)).toEqual(names(template).filter((name) => name !== 'n'))
      }),
      { seed: SEED, numRuns: 150 },
    )
  })

  it('P-I3: a formatted count picks the same plural form as the number itself', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.constantFrom<Locale>('en', 'es'), (n, locale) => {
        const tpl = '{v|# one|# many}'
        expect(interpolate(tpl, { v: formatNumber(n, locale) }, locale).endsWith(n === 1 ? 'one' : 'many')).toBe(true)
      }),
      { seed: SEED, numRuns: 400 },
    )
  })

  it('P-I3: a formatted fraction is plural, never singular (0,01 and 1,5 are not "1")', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 999.99, noNaN: true }).filter((x) => Math.abs(x - Math.round(x)) > 0.005), fc.constantFrom<Locale>('en', 'es'), (x, locale) => {
        const text = formatDecimal(x, locale, 2)
        expect(interpolate('{v|# one|# many}', { v: text }, locale)).toBe(`${text} many`)
      }),
      { seed: SEED, numRuns: 400 },
    )
  })

  it('P-I4: formatDecimal uses the locale separator, keeps the digits and never prints NaN or -0', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.integer({ min: 0, max: 3 }), fc.constantFrom<Locale>('en', 'es'), (x, digits, locale) => {
        const text = formatDecimal(x, locale, digits)
        expect(text).toMatch(digits === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+${locale === 'es' ? ',' : '\\.'}\\d{${digits}}$`))
        expect(text).not.toMatch(/^-0([.,]0*)?$/)
        expect(Math.abs(Number(text.replace(',', '.')) - x)).toBeLessThanOrEqual(0.5 * 10 ** -digits + 1e-9)
      }),
      { seed: SEED, numRuns: 400 },
    )
  })
})
