import { describe, expect, it } from 'vitest'
import { en } from '../../i18n/en.ts'
import { es } from '../../i18n/es.ts'
import { interpolate } from '../../i18n/locale.ts'
import { englishWord, parsePron, spanishStress, spanishWord, textToPhones, unknownEnglishWords } from './g2p.ts'
import { spellNumber, spellNumbersInText } from './numbers.ts'
import { PHONEMES } from './phonemes.ts'
import { renderPhones, renderText } from './synth.ts'

const syms = (phones: { p: string }[]) => phones.map((p) => p.p).join(' ')

describe('numbers in words', () => {
  it('spells English numbers', () => {
    const cases: [number, string][] = [
      [0, 'zero'], [7, 'seven'], [15, 'fifteen'], [21, 'twenty one'], [30, 'thirty'], [99, 'ninety nine'], [100, 'one hundred'],
      [250, 'two hundred fifty'], [1000, 'one thousand'], [10_065, 'ten thousand sixty five'], [2_000_001, 'two million one'],
    ]
    for (const [n, words] of cases) expect(spellNumber(n, 'en')).toBe(words)
  })

  it('spells Spanish numbers, with the short "un" before masculine nouns', () => {
    const cases: [number, string][] = [
      [0, 'cero'], [1, 'uno'], [16, 'dieciséis'], [21, 'veintiuno'], [22, 'veintidós'], [30, 'treinta'], [31, 'treinta y uno'], [100, 'cien'],
      [101, 'ciento uno'], [250, 'doscientos cincuenta'], [500, 'quinientos'], [1000, 'mil'], [2021, 'dos mil veintiuno'],
      [21_000, 'veintiún mil'], [10_065, 'diez mil sesenta y cinco'], [1_000_000, 'un millón'],
    ]
    for (const [n, words] of cases) expect(spellNumber(n, 'es')).toBe(words)
    expect(spellNumbersInText('Falta 1 metro', 'es')).toBe('Falta un metro')
    expect(spellNumbersInText('21 pasos', 'es')).toBe('veintiún pasos')
    expect(spellNumbersInText('Gema 1 de 10', 'es')).toBe('Gema uno de diez')
  })

  it('reads thousand separators as one number', () => {
    expect(spellNumbersInText('10.065 pasos', 'es')).toBe('diez mil sesenta y cinco pasos')
    expect(spellNumbersInText('10,065 steps', 'en')).toBe('ten thousand sixty five steps')
    expect(spellNumbersInText('Gem 3 of 10', 'en')).toBe('Gem three of ten')
  })
})

describe('Spanish pronunciation rules', () => {
  it('finds the stressed vowel', () => {
    const stressed = (w: string) => w[spanishStress(w)]
    expect(spanishStress('metros')).toBe(1) // mE-tros
    expect(stressed('misión')).toBe('ó')
    expect(spanishStress('bandera')).toBe(4) // ban-dE-ra
    expect(spanishStress('ciudad')).toBe(4) // ciu-dAd (ends in d: last syllable)
    expect(spanishStress('siguiente')).toBe(5) // si-guiEn-te
    expect(spanishStress('izquierda')).toBe(5) // iz-quiEr-da
  })

  it('converts spelling to sounds', () => {
    expect(syms(spanishWord('gema'))).toBe('X E M A')
    expect(syms(spanishWord('queda'))).toBe('K E D A')
    expect(syms(spanishWord('guerra'))).toBe('G E RR A')
    expect(syms(spanishWord('calle'))).toBe('K A Y E')
    expect(syms(spanishWord('ciento'))).toBe('TH Y E N T O')
    expect(syms(spanishWord('ruta'))).toBe('RR U T A')
    expect(syms(spanishWord('hacia'))).toBe('A TH Y A')
    expect(syms(spanishWord('muy'))).toBe('M U I')
    expect(syms(spanishWord('noreste'))).toBe('N O RX E S T E')
    expect(spanishWord('metros').find((p) => p.stress)?.p).toBe('E')
  })
})

describe('English pronunciation', () => {
  it('parses dictionary entries and marks stress', () => {
    expect(syms(parsePron('K W EH S T'))).toBe('K W EH S T')
    expect(parsePron('K W EH S T').find((p) => p.stress)?.p).toBe('EH')
    expect(parsePron('M IY1 T ER').findIndex((p) => p.stress)).toBe(1)
    expect(() => parsePron('Q Q')).toThrow()
  })

  it('knows every word the app says in English', () => {
    const vars = { m: 30, n: 3, total: 10, steps: 10_065, dir: 'north-east' }
    const keys = Object.keys(en).filter((k) => k.startsWith('voice.')) as (keyof typeof en)[]
    expect(keys.length).toBeGreaterThan(10)
    for (const dir of ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'])
      for (const m of [1, 30, 250, 1200]) {
        for (const key of keys) {
          const text = spellNumbersInText(interpolate(en[key], { ...vars, m, dir }, 'en'), 'en')
          expect(unknownEnglishWords(text), `${key}: ${text}`).toEqual([])
        }
      }
  })

  it('falls back to letter rules for unknown words', () => {
    const phones = englishWord('blip')
    expect(syms(phones)).toBe('B L IH P')
  })

  it('turns Spanish phrases into known phonemes only', () => {
    const keys = Object.keys(es).filter((k) => k.startsWith('voice.')) as (keyof typeof es)[]
    for (const key of keys) {
      const text = spellNumbersInText(interpolate(es[key], { m: 21, n: 1, total: 10, steps: 10_065, dir: 'suroeste' }, 'es'), 'es')
      const phones = textToPhones(text, 'es')
      expect(phones.length, key).toBeGreaterThan(5)
      for (const p of phones) expect(PHONEMES[p.p], `${key}: ${p.p}`).toBeDefined()
    }
  })

  it('adds word gaps and pauses at punctuation', () => {
    const phones = textToPhones('Back on route. Well done!', 'en')
    expect(phones.filter((p) => p.p === '.')).toHaveLength(1)
    expect(phones.filter((p) => p.p === '_')).toHaveLength(3)
    expect(phones[phones.length - 1]!.p).not.toBe('.')
  })
})

/** Energy of a signal at one frequency (Goertzel). */
function energyAt(x: Float32Array, freq: number, sr: number, from = 0, to = x.length): number {
  const k = 2 * Math.cos((2 * Math.PI * freq) / sr)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    const s = x[i]! + k * s1 - s2
    s2 = s1
    s1 = s
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2
}

describe('formant synthesizer', () => {
  it('renders clean, bounded, non-silent audio of a sensible length', () => {
    const x = renderText('Gem 3 of 10! Next gem in 120 meters, north-east.', 'en')
    const seconds = x.length / 22050
    expect(seconds).toBeGreaterThan(2)
    expect(seconds).toBeLessThan(8)
    let peak = 0
    let sumSq = 0
    for (const v of x) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
      sumSq += v * v
    }
    expect(peak).toBeLessThanOrEqual(1)
    expect(peak).toBeGreaterThan(0.5)
    expect(Math.sqrt(sumSq / x.length)).toBeGreaterThan(0.05)
    // Starts and ends in silence (no clicks).
    expect(Math.abs(x[0]!)).toBe(0)
    expect(Math.abs(x[x.length - 1]!)).toBe(0)
  })

  it('is deterministic and longer text takes longer', () => {
    expect(renderText('Back on route.', 'en')).toEqual(renderText('Back on route.', 'en'))
    expect(renderText('Back on route. Well done!', 'en').length).toBeGreaterThan(renderText('Back on route.', 'en').length)
    expect(renderText('De vuelta en la ruta.', 'es', { speed: 1.5 }).length).toBeLessThan(renderText('De vuelta en la ruta.', 'es').length)
  })

  it('puts vowel energy at the right formants', () => {
    const sr = 22050
    const ee = renderPhones([{ p: 'IY', len: 4 }], { bits: 0 })
    const ah = renderPhones([{ p: 'AA', len: 4 }], { bits: 0 })
    const mid = (x: Float32Array) => [Math.floor(x.length * 0.3), Math.floor(x.length * 0.7)] as const
    const ratio = (x: Float32Array) => {
      const [a, b] = mid(x)
      return energyAt(x, 2290, sr, a, b) / energyAt(x, 1090, sr, a, b)
    }
    // "ee" has a high second formant, "ah" a low one.
    expect(ratio(ee)).toBeGreaterThan(ratio(ah) * 5)
  })

  it('makes /s/ a hiss above the voice band', () => {
    const sr = 22050
    const s = renderPhones([{ p: 'S', len: 4 }], { bits: 0 })
    const [a, b] = [Math.floor(s.length * 0.3), Math.floor(s.length * 0.7)]
    expect(energyAt(s, 3500, sr, a, b)).toBeGreaterThan(energyAt(s, 500, sr, a, b) * 3)
  })

  it('keeps hiss soft: little energy above 5 kHz compared with the old raw voice', () => {
    const sr = 22050
    const text = 'Quest started! First gem in 250 meters, south-west.'
    const soft = renderText(text, 'en')
    const raw = renderText(text, 'en', { lowpassHz: 0, noiseLevel: 1, bits: 6 })
    const hf = (x: Float32Array) => [6000, 7000, 8000, 9000].reduce((t, f) => t + energyAt(x, f, sr, 0, x.length), 0)
    const mid = (x: Float32Array) => [400, 700, 1000, 1300].reduce((t, f) => t + energyAt(x, f, sr, 0, x.length), 0)
    const ratio = (x: Float32Array) => hf(x) / mid(x)
    // At least 15 dB less fizz, relative to the voice band.
    expect(ratio(soft)).toBeLessThan(ratio(raw) / 30)
  })

  it('does not bit-crush by default (smooth samples, no 6-bit steps)', () => {
    const x = renderText('Back on route.', 'en')
    const levels = new Set(Array.from(x, (v) => Math.round(v * 32767)))
    expect(levels.size).toBeGreaterThan(1000)
    const crushed = renderText('Back on route.', 'en', { bits: 6 })
    expect(new Set(Array.from(crushed, (v) => Math.round(v * 32767))).size).toBeLessThanOrEqual(65)
  })

  it('renders an empty phrase as silence', () => {
    const x = renderText('', 'en')
    expect(x.every((v) => v === 0)).toBe(true)
  })
})
