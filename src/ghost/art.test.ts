import { describe, expect, it } from 'vitest'
import { GHOST_BOO, GHOST_FLOAT, GHOST_FRAMES, GHOST_HAPPY } from './art.ts'

const cell = (rows: readonly string[], y: number, x: number) => rows[y]?.[x] ?? '.'

describe("Wisp's face", () => {
  const rows = GHOST_FLOAT[0]!.rows

  it('has two separate 2×2 ink eyes, symmetric and spaced apart', () => {
    for (const y of [4, 5]) {
      expect([4, 5, 9, 10].map((x) => cell(rows, y, x))).toEqual(['K', 'K', 'K', 'K'])
      expect([6, 7, 8].map((x) => cell(rows, y, x))).toEqual(['W', 'W', 'W'])
    }
  })

  it('has a one-pixel mouth below a clear row, blush on both cheeks, and keeps the lantern', () => {
    expect(cell(rows, 7, 7)).toBe('K')
    expect([3, 4, 10, 11].map((x) => cell(rows, 6, x)).join('')).toBe('BBBB')
    expect([6, 7, 8].map((x) => cell(rows, 6, x)).join('')).toBe('WWW')
    expect(rows.join('')).toContain('L')
  })

  it('never reads as a plus: no ink pixel inside the head has ink on all four sides', () => {
    for (const f of GHOST_FRAMES) {
      for (let y = 3; y < 10; y++) {
        for (let x = 3; x < 12; x++) {
          const ink = (yy: number, xx: number) => cell(f.rows, yy, xx) === 'K'
          expect(ink(y, x) && ink(y - 1, x) && ink(y + 1, x) && ink(y, x - 1) && ink(y, x + 1)).toBe(false)
        }
      }
    }
  })

  it('smiles when happy and opens its mouth for boo', () => {
    expect(cell(GHOST_HAPPY.rows, 8, 7)).toBe('K')
    expect(cell(GHOST_BOO.rows, 8, 7)).toBe('K')
    expect(cell(GHOST_BOO.rows, 7, 6) + cell(GHOST_BOO.rows, 7, 8)).toBe('KK')
  })
})
