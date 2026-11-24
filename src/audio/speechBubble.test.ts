import { describe, expect, it } from 'vitest'
import { bubbleDurationMs, wrapBubbleText } from './speechBubble.ts'

describe('bubbleDurationMs', () => {
  it('grows with the text and stays within 1.8 to 7 seconds', () => {
    expect(bubbleDurationMs('Go.')).toBe(1800)
    expect(bubbleDurationMs('a'.repeat(30))).toBeGreaterThan(bubbleDurationMs('a'.repeat(20)))
    expect(bubbleDurationMs('a'.repeat(500))).toBe(7000)
  })
})

describe('wrapBubbleText', () => {
  it('wraps on words and keeps every character', () => {
    const text = 'Checkpoint three reached. Next in 400 metres.'
    const lines = wrapBubbleText(text, 14)
    expect(lines.every((l) => l.length <= 14)).toBe(true)
    expect(lines.join(' ')).toBe(text)
  })
  it('splits words longer than a line', () => {
    expect(wrapBubbleText('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic'])
  })
  it('returns nothing for blank text', () => {
    expect(wrapBubbleText('  ', 10)).toEqual([])
  })
})

describe('wrapBubbleText (review Nov 2026)', () => {
  it('B16: terminates for a width below one, or not a number, and keeps every character', () => {
    for (const width of [0, -3, NaN, 0.4, -Infinity]) {
      const lines = wrapBubbleText('Turn left', width)
      expect(lines.join('')).toBe('Turnleft')
      expect(lines.every((l) => l.length === 1)).toBe(true)
    }
    expect(wrapBubbleText('abc', Infinity)).toEqual(['a', 'b', 'c'])
  })
  it('B16: never cuts a character outside the basic plane in half', () => {
    const lines = wrapBubbleText('go 🚶🚶🚶 now', 2)
    expect(lines.join('')).toBe('go🚶🚶🚶now')
    for (const l of lines) expect(Array.from(l).length).toBeLessThanOrEqual(2)
    expect(lines.every((l) => !/[\ud800-\udbff]$/.test(l) && !/^[\udc00-\udfff]/.test(l))).toBe(true)
  })
})
