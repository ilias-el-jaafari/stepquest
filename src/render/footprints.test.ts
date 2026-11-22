import { describe, expect, it } from 'vitest'
import { dirIndex, FOOT_DIRS, FOOT_PATTERNS, footprints } from './routePath.ts'

describe('route footprints', () => {
  const line = [
    { x: 0, y: 0, along: 0 },
    { x: 100, y: 0, along: 50 },
  ]
  it('places prints at a steady spacing, alternating left and right of the line', () => {
    const f = footprints(line, 10, 3)
    expect(f).toHaveLength(10)
    expect(f.map((p) => p.left)).toEqual([true, false, true, false, true, false, true, false, true, false])
    // Walking east on screen, the left foot is above the line (smaller y).
    expect(f[0]!.y).toBe(-3)
    expect(f[1]!.y).toBe(3)
    expect(f[0]!.x).toBe(5)
    expect(f[1]!.x - f[0]!.x).toBe(10)
  })
  it('turns prints along the path and carries the walked distance', () => {
    const f = footprints([{ x: 0, y: 0, along: 0 }, { x: 0, y: 40, along: 20 }], 10, 2)
    expect(dirIndex(f[0]!.angle, FOOT_DIRS)).toBe(4) // facing down the screen
    expect(f[0]!.along).toBeCloseTo(2.5)
    expect(f.at(-1)!.along).toBeCloseTo(17.5)
  })
  it('keeps more prints on screen when zoomed in (spacing is in screen pixels)', () => {
    const far = footprints(line, 10, 2).length
    const near = footprints(line.map((p) => ({ ...p, x: p.x * 4 })), 10, 2).length
    expect(near).toBe(far * 4)
  })
  it('has pixel art for every direction and both feet, mirrored', () => {
    expect(FOOT_PATTERNS).toHaveLength(2)
    for (const foot of FOOT_PATTERNS) {
      expect(foot).toHaveLength(FOOT_DIRS)
      for (const rows of foot) {
        expect(rows).toHaveLength(9)
        const fill = rows.join('').split('').filter((c) => c === 'f').length
        expect(fill).toBeGreaterThan(8)
        expect(fill).toBeLessThan(30)
      }
    }
    // Facing down, the left foot's sole sits further east (the walker's left) than the right foot's.
    const col = (rows: readonly string[]) => {
      let sum = 0
      let n = 0
      rows.forEach((r) => [...r].forEach((c, x) => c === 'f' && ((sum += x), n++)))
      return sum / n
    }
    expect(col(FOOT_PATTERNS[0]![4]!)).toBeGreaterThan(col(FOOT_PATTERNS[1]![4]!))
  })
  it('draws nothing for an empty route', () => {
    expect(footprints([], 10, 2)).toEqual([])
    expect(footprints([{ x: 0, y: 0, along: 0 }], 10, 2)).toEqual([])
  })
})
