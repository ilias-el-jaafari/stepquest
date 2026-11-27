import { describe, expect, it } from 'vitest'
import { en, type MessageKey } from './en.ts'
import { es } from './es.ts'
import { interpolate, type Locale } from './locale.ts'

/**
 * Every error, empty, offline, permission and loading-failure line. Owning spec:
 * `.kiro/specs/error-copy/requirements.md`; voice rules: "Mischief in errors" in `copy-voice.md`.
 * Add a new error key here and to the spec table together.
 */
export const ERROR_KEYS = [
  // Planning
  'error.tooShort', 'error.tooShortLoop', 'error.outOfRange', 'error.tooLong', 'error.noMatch', 'error.outsideArea', 'error.unreachable',
  'error.samePoint', 'error.planFailed', 'error.planStreets', 'error.planTimeout', 'map.finishNone', 'area.outside',
  // Streets to avoid, fields and coordinates
  'safety.noStreet', 'safety.noMatch', 'safety.infeasible', 'safety.avoidIgnored', 'target.invalid', 'stride.invalid', 'data.badCoords',
  // Map data
  'data.err.busy', 'data.err.rateLimited', 'data.err.tooLarge', 'data.err.network', 'data.err.badResponse', 'data.err.badArea', 'map.error',
  // Location (planner)
  'loc.weak', 'loc.areaFailed', 'loc.err.unsupported', 'loc.err.insecure', 'loc.err.denied', 'loc.err.unavailable', 'loc.err.timeout', 'loc.err.inaccurate',
  // Quest (GPS and saved quest)
  'quest.weak', 'quest.lost', 'quest.offRoute', 'quest.err.denied', 'quest.err.unsupported', 'quest.err.insecure', 'quest.err.unavailable',
  'quest.err.timeout', 'quest.err.inaccurate', 'quest.resumeFailed',
  // Offline, empty, sound, crash
  'net.offline', 'result.empty', 'sound.resume', 'crash.body',
] as const satisfies readonly MessageKey[]

/** One action verb per language, as a whole word (letters only on both sides, so "Sal" is not "Salida"). */
const VERBS: Record<Locale, RegExp> = {
  en: /(?<!\p{L})(tap|raise|lower|move|try|retry|turn|pick|type|check|step|keep|head|go|reload)(?!\p{L})/iu,
  es: /(?<!\p{L})(toca|sube|baja|acerca|aleja|mueve|prueba|reintentar|reintenta|activa|actívala|elige|pon|escribe|sal|ve|sigue|mantén|conéctate|recarga|revisa)(?!\p{L})/iu,
}

/** Words that point the finger at the player. */
const BLAME: Record<Locale, RegExp> = {
  en: /\b(you (?:failed|forgot|must|should|did not|didn’t|denied)|your fault|invalid|illegal|wrong)\b/i,
  es: /\b(has (?:fallado|olvidado|denegado|rechazado)|tu culpa|inválid[oa]|debes|ilegal)\b/i,
}

/** Typical values for the placeholders, as the longest case likely to show. */
const SAMPLE = { min: '10.000', max: '10.000', steps: '10.000', m: 250, dir: 'suroeste', value: 2000, names: 'Calle Mayor', n: 2 }

/** 390 px phone: 334 px planner box, 20 px of padding and border, 8 px glyphs, so 39 characters a line. */
const CHARS_PER_LINE = 39
const MAX_LINES = 2

function lineCount(text: string): number {
  let lines = 1
  let current = 0
  for (const word of text.split(' ')) {
    const w = [...word].length
    if (current > 0 && current + 1 + w > CHARS_PER_LINE) {
      lines++
      current = w
    } else current = current > 0 ? current + 1 + w : w
  }
  return lines
}

const tables = { en, es } as const
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort()

describe.each(['en', 'es'] as const)('error copy (%s)', (locale) => {
  const table = tables[locale]

  it('has every error key, filled in', () => {
    for (const key of ERROR_KEYS) expect(table[key]?.trim().length, key).toBeGreaterThan(0)
  })

  it('names an action to take (a verb from the list)', () => {
    for (const key of ERROR_KEYS) expect(table[key], `${locale} ${key}`).toMatch(VERBS[locale])
  })

  it('never blames the player', () => {
    for (const key of ERROR_KEYS) expect(table[key], `${locale} ${key}`).not.toMatch(BLAME[locale])
  })

  it(`fits ${MAX_LINES} lines on a 390 px phone`, () => {
    for (const key of ERROR_KEYS) {
      if (key === 'crash.body') continue // the crash box is its own wider panel
      const text = interpolate(table[key], SAMPLE, locale)
      expect(lineCount(text), `${locale} ${key} (${text.length} chars): ${text}`).toBeLessThanOrEqual(MAX_LINES)
    }
  })
})

describe('error copy in both languages', () => {
  it('exists in English and Spanish with the same placeholders', () => {
    for (const key of ERROR_KEYS) {
      expect(key in en && key in es, key).toBe(true)
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('has no duplicates in the list', () => {
    expect(new Set(ERROR_KEYS).size).toBe(ERROR_KEYS.length)
  })

  it('only points at labels that exist (text in « » or “ ” matches another string of the dictionary)', () => {
    for (const [table, quote] of [[en, /“([^”]+)”/g], [es, /«([^»]+)»/g]] as const) {
      const known = new Set(Object.values(table).map((v) => v.replace(/\{[^}]*\}/g, '').trim().replace(/[….]+$/, '')))
      for (const key of ERROR_KEYS) {
        for (const m of table[key].matchAll(quote)) expect(known.has(m[1]!), `${key} points at “${m[1]}” which is not a label`).toBe(true)
      }
    }
  })
})
