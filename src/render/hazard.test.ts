import { describe, expect, it } from 'vitest'
import { hazardStamps, midpoint, NO_ENTRY } from './hazard.ts'

describe('hazard tape', () => {
  it('stamps every art pixel, snapped to the pixel grid', () => {
    const s = hazardStamps([{ x: 0, y: 0 }, { x: 20, y: 0 }], 2, 6)
    expect(s).toHaveLength(11)
    expect(s.every((p) => p.x % 2 === 0 && p.y === 0)).toBe(true)
  })
  it('alternates dashes and keeps the pattern running round corners', () => {
    const s = hazardStamps([{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }], 1, 4)
    const on = s.map((p) => (p.on ? 1 : 0)).join('')
    expect(on.startsWith('11110000')).toBe(true)
    // Dash phase continues across the corner: 12–15 px is the fourth dash (off), 16–19 px on.
    expect(s[13]!.on).toBe(false)
    expect(s[17]!.on).toBe(true)
    expect(on).toBe('1111000011110000111100001')
  })
  it('handles empty and degenerate input', () => {
    expect(hazardStamps([], 1, 4)).toEqual([])
    expect(hazardStamps([{ x: 3, y: 3 }], 1, 4)).toEqual([{ x: 3, y: 3, on: true }])
    expect(hazardStamps([{ x: 0, y: 0 }, { x: 4, y: 0 }], 0, 4)).toEqual([])
  })
  it('finds the halfway point by length', () => {
    expect(midpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }])).toEqual({ x: 10, y: 10 })
    expect(midpoint([{ x: 5, y: 5 }])).toEqual({ x: 5, y: 5 })
    expect(midpoint([])).toBeUndefined()
  })
  it('has a square, symmetric no-entry sign', () => {
    expect(NO_ENTRY.every((r) => r.length === NO_ENTRY.length)).toBe(true)
    expect(NO_ENTRY.map((r) => [...r].reverse().join(''))).toEqual(NO_ENTRY)
    expect(NO_ENTRY.join('')).toMatch(/w/)
  })
})
