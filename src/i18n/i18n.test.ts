import { beforeEach, describe, expect, it } from 'vitest'
import { LOCALE_STORAGE_KEY } from '../config/brand.ts'
import { en, type MessageKey } from './en.ts'
import { es } from './es.ts'
import { detectLocale, interpolate, readStoredLocale } from './locale.ts'

describe('dictionaries', () => {
  it('has the same keys in English and Spanish', () => {
    const enKeys = Object.keys(en).sort()
    const esKeys = Object.keys(es).sort()
    expect(esKeys).toEqual(enKeys)
  })

  it('does not leave Spanish entries empty', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(es[key]?.trim().length, key).toBeGreaterThan(0)
    }
  })
})

describe('interpolate', () => {
  it('replaces named placeholders and leaves unknown ones alone', () => {
    expect(interpolate('Hello {name}', { name: 'Ilias' })).toBe('Hello Ilias')
    expect(interpolate('{n} of {max}', { n: 9, max: 10 })).toBe('9 of 10')
    expect(interpolate('Keep {missing}', {})).toBe('Keep {missing}')
  })
  it('picks plural forms with the locale rules', () => {
    const tpl = '{n} {n|checkpoint|checkpoints}'
    expect(interpolate(tpl, { n: 1 }, 'en')).toBe('1 checkpoint')
    expect(interpolate(tpl, { n: 0 }, 'en')).toBe('0 checkpoints')
    expect(interpolate(tpl, { n: 10 }, 'en')).toBe('10 checkpoints')
    expect(interpolate('{s} {s|paso|pasos}', { s: '1' }, 'es')).toBe('1 paso')
    // Formatted numbers count by their digits.
    expect(interpolate('{s} {s|paso|pasos}', { s: '10.000' }, 'es')).toBe('10.000 pasos')
    expect(interpolate('{n|Has recogido el único checkpoint.|Has recogido los # checkpoints.}', { n: 3 }, 'es')).toBe('Has recogido los 3 checkpoints.')
  })
  it('never says "1 checkpoints" or "1 pasos" in either language', () => {
    for (const [table, locale] of [[en, 'en'], [es, 'es']] as const) {
      for (const key of Object.keys(table) as MessageKey[]) {
        const vars = { n: 1, steps: '1', min: '1', max: '2', left: 1, total: 1, km: '1 km', every: 1, value: '1' }
        const out = interpolate(table[key], vars, locale)
        expect(out, key).not.toMatch(/\b1 (checkpoints|pasos|steps|gemas|gems)\b/)
        expect(out, key).not.toMatch(/\blos 1\b/)
      }
    }
  })
})

describe('interpolate with decimal strings', () => {
  it('reads "0,01" as a fraction, not as 1 (so it never says "0,01 metro")', () => {
    const tpl = '{v} {v|metro|metros}'
    expect(interpolate(tpl, { v: '0,01' }, 'es')).toBe('0,01 metros')
    expect(interpolate(tpl, { v: '1,5' }, 'es')).toBe('1,5 metros')
    expect(interpolate(tpl, { v: '1.000' }, 'es')).toBe('1.000 metros')
    expect(interpolate(tpl, { v: '1' }, 'es')).toBe('1 metro')
    expect(interpolate('{v} {v|meter|meters}', { v: '1,000' }, 'en')).toBe('1,000 meters')
    expect(interpolate('{v} {v|meter|meters}', { v: '0.01' }, 'en')).toBe('0.01 meters')
  })
})

describe('detectLocale', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('takes the first supported language of the preference list', () => {
    expect(detectLocale(['ca-ES', 'es-ES', 'en'])).toBe('es')
    expect(detectLocale(['fr', 'en-GB', 'es'])).toBe('en')
    expect(detectLocale(['fr', 'de'])).toBe('en')
    expect(detectLocale([])).toBe('en')
    expect(detectLocale(['ES_mx'])).toBe('es')
  })

  it('does not mistake languages that merely start with the letters "es"', () => {
    expect(detectLocale('est')).toBe('en')
    expect(detectLocale('es')).toBe('es')
    expect(detectLocale('es-419')).toBe('es')
  })

  it('defaults to English for unknown or missing languages', () => {
    expect(detectLocale('en-US')).toBe('en')
    expect(detectLocale('fr-FR')).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
  })

  it('defaults to Spanish when the browser language starts with es', () => {
    expect(detectLocale('es')).toBe('es')
    expect(detectLocale('es-ES')).toBe('es')
    expect(detectLocale('es-MX')).toBe('es')
  })

  it('prefers a stored locale over the browser language', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    expect(readStoredLocale()).toBe('es')
    expect(detectLocale('en-US')).toBe('es')
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    expect(detectLocale('es-ES')).toBe('en')
  })

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de')
    expect(readStoredLocale()).toBeUndefined()
    expect(detectLocale('es-ES')).toBe('es')
  })
})

describe('placeholders', () => {
  it('uses the same {placeholders} in both languages', () => {
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)[|}]/g)].map((m) => m[1]))].sort()
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(names(es[key]), key).toEqual(names(en[key]))
    }
  })
})

describe('fallback wording', () => {
  it('keeps the "fits your goal on any street" fallback neutral (safety is a default, not a mode)', () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      for (const key of ['safety.infeasible', 'safety.useNormal', 'safety.usingNormal']) {
        expect(dict[key], key).toBeDefined()
        expect(dict[key]!.toLowerCase(), key).not.toMatch(/safe|segur|normal/)
      }
    }
  })
})
