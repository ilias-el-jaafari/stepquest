import { describe, expect, it } from 'vitest'
import { en, type MessageKey } from './en.ts'
import { es } from './es.ts'

/** Dev-speak that must never reach a player. Keep in step with `.kiro/steering/copy-voice.md`. */
const BANNED: RegExp[] = [
  /cannot be disabled/i, /can(?:'|’)?t be (?:disabled|turned off)/i, /no switch/i, /always on/i, /we decided/i, /by design/i,
  /hackathon/i, /judges?\b/i, /kiroween/i, /resurrection/i, /overpass/i, /\bapi\b/i, /\bcache\b/i,
  /\bworkers?\b/i, /\bspecs?\b/i, /\bA\*/, /\bgraph\b/i, /\btiles?\b/i, /\bchunks?\b/i, /\bdevelop(?:ment|er)s?\b/i,
  /no se puede desactivar/i, /no se puede apagar/i, /hemos decidido/i, /hemos elegido/i, /sin interruptor/i, /siempre activo/i,
  /jueces?\b/i, /hackat[oó]n/i, /\bcach[eé]\b/i, /\bgrafo\b/i, /\bteselas?\b/i, /desarroll/i,
]

const keys = Object.keys(en) as MessageKey[]

describe('product voice (user-facing copy)', () => {
  it('holds no development talk in either language', () => {
    for (const [locale, table] of Object.entries({ en, es })) {
      for (const key of keys) {
        for (const banned of BANNED) expect(table[key], `${locale} ${key} matches ${banned}`).not.toMatch(banned)
      }
    }
  })

  it('names OpenStreetMap only in the required attribution', () => {
    for (const table of [en, es]) {
      for (const key of keys) {
        if (key === 'map.attribution') expect(table[key]).toMatch(/OpenStreetMap/)
        else expect(table[key], key).not.toMatch(/OpenStreetMap/i)
      }
    }
    expect(en['map.attribution']).toBe('© OpenStreetMap contributors')
  })

  it('addresses Spanish players as "tú"', () => {
    for (const key of keys) expect(es[key], key).not.toMatch(/\b(usted|ustedes|vosotros)\b/i)
  })
})
