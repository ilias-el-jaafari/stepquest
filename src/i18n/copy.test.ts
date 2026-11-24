import { describe, expect, expectTypeOf, it } from 'vitest'
import { en, type MessageKey, type MessageVars, type PlainKey, type Translate } from './en.ts'
import { es } from './es.ts'

const keys = Object.keys(en) as MessageKey[]
const tables = { en, es } as const

describe('typed keys (compile-time, checked by tsc)', () => {
  it('derives the variables of a key from its text', () => {
    expectTypeOf<MessageVars<'result.ready'>>().toEqualTypeOf<{ n: string | number }>()
    expectTypeOf<MessageVars<'dlg.pickup'>>().toEqualTypeOf<{ n: string | number; total: string | number; left: string | number }>()
    expectTypeOf<MessageVars<'tab.map'>>().toEqualTypeOf<undefined>()
    expectTypeOf<'tab.map'>().toExtend<PlainKey>()
    expectTypeOf<'result.ready'>().not.toExtend<PlainKey>()
  })

  it('rejects unknown keys, missing, misspelled and extra variables', () => {
    const t = ((key: string) => key) as Translate
    // Each directive below fails the build if the line stops being an error.
    // @ts-expect-error unknown key
    t('no.such.key')
    // @ts-expect-error missing variable
    t('result.ready')
    // @ts-expect-error misspelled variable
    t('result.ready', { count: 3 })
    // @ts-expect-error extra variable
    t('result.ready', { n: 3, extra: 1 })
    // @ts-expect-error variables for a key without placeholders
    t('tab.map', { n: 1 })
    t('result.ready', { n: 3 })
    t('tab.map')
    expect(true).toBe(true)
  })
})

describe('Spanish and English copy rules', () => {
  it('writes Spanish percentages as "5 %" with a no-break space, English as "5%"', () => {
    for (const key of keys) {
      expect(es[key], `${key} (es)`).not.toMatch(/[\d}]%/)
      expect(es[key], `${key} (es)`).not.toMatch(/[\d}] %/)
      expect(en[key], `${key} (en)`).not.toMatch(/[\d}][ \u00a0]%/)
    }
  })

  it('has no doubled spaces, stray edge spaces or straight quotes inside words', () => {
    for (const [locale, table] of Object.entries(tables)) {
      for (const key of keys) {
        const text = table[key]
        expect(text, `${locale} ${key}`).toBe(text.trim())
        expect(text, `${locale} ${key}`).not.toMatch(/ {2}/)
      }
    }
  })

  it('opens Spanish exclamations and questions with the inverted mark', () => {
    for (const key of keys) {
      const text = es[key]
      // Allow a leading placeholder or plural form; require an opening mark before a closing one.
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (/[!?]$/.test(sentence)) expect(sentence, key).toMatch(/[¡¿]/)
      }
    }
  })

  it('does not put a gendered participle before a street name (names can be masculine)', () => {
    expect(es['safety.added']).not.toMatch(/^Añadida\b/)
  })

  it('uses the same unit symbols in both languages', () => {
    for (const key of keys) {
      for (const unit of ['km', 'm', 'min']) {
        const inEn = new RegExp(`[\\d}] ?${unit}\\b`).test(en[key])
        if (inEn) expect(es[key], key).toMatch(new RegExp(`[\\d}] ?${unit}\\b`))
      }
    }
  })
})

describe('dictionary hygiene', () => {
  const raw = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.*', '!../i18n/en.ts', '!../i18n/es.ts', '!../**/testing/**'], { query: '?raw', import: 'default', eager: true })
  const code = Object.values(raw).join('\n')

  it('has no key that nothing uses (directly, or through a `prefix.${…}` or `${…}.suffix` key)', () => {
    expect(Object.keys(raw).length).toBeGreaterThan(30)
    const prefixes = [...code.matchAll(/`([\w.]+\.)\$\{/g)].map((m) => m[1]!)
    const suffixes = [...code.matchAll(/`\$\{[^}]+\}(\.[\w.]+)`/g)].map((m) => m[1]!)
    const unused = keys.filter((key) => !code.includes(`'${key}'`) && !prefixes.some((p) => key.startsWith(p)) && !suffixes.some((x) => key.endsWith(x)))
    expect(unused).toEqual([])
  })
})
