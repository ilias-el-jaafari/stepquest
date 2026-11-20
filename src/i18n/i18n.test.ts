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
})

describe('detectLocale', () => {
  beforeEach(() => {
    localStorage.clear()
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
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(names(es[key]), key).toEqual(names(en[key]))
    }
  })
})
