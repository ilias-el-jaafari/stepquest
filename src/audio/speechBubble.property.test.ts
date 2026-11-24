import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bubbleDurationMs, wrapBubbleText } from './speechBubble.ts'

const SEED = 20261204
const textArb = fc.string({ unit: fc.constantFrom(...'abcdefghij ÁñÜ.,!?¿\n\t0123456789'.split('')), maxLength: 200 })

describe('speech bubble properties', () => {
  it('P-V1: wrapped lines never exceed the width, are never empty, and no text is lost', () => {
    fc.assert(
      fc.property(textArb, fc.integer({ min: 1, max: 40 }), (text, maxChars) => {
        const lines = wrapBubbleText(text, maxChars)
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(maxChars)
          expect(line.length).toBeGreaterThan(0)
        }
        // Dropping all whitespace, the characters are exactly the same and in the same order.
        const squash = (s: string) => s.replace(/\s+/g, '')
        expect(squash(lines.join(' '))).toBe(squash(text))
        // Words are only split when they are longer than a line.
        const words = text.split(/\s+/).filter(Boolean)
        if (words.every((w) => w.length <= maxChars)) expect(lines.flatMap((l) => l.split(' '))).toEqual(words)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-V2: the silent bubble time stays between 1.8 s and 7 s and never shrinks with longer text', () => {
    fc.assert(
      fc.property(textArb, textArb, (a, b) => {
        for (const t of [a, b]) {
          expect(bubbleDurationMs(t)).toBeGreaterThanOrEqual(1800)
          expect(bubbleDurationMs(t)).toBeLessThanOrEqual(7000)
        }
        const [short, long] = a.length <= b.length ? [a, b] : [b, a]
        expect(bubbleDurationMs(long)).toBeGreaterThanOrEqual(bubbleDurationMs(short))
      }),
      { seed: SEED, numRuns: 100 },
    )
  })
})
