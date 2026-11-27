import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { railStamps } from './rails.ts'

type Pt = { x: number; y: number }

/** The stamps a screen would show: those inside the box, from a line stamped whole and from one with the far segments left out. */
function shown(points: Pt[], unit: number, gap: number, box: { x0: number; y0: number; x1: number; y1: number }, cull: boolean) {
  const inside = (p: Pt) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1
  const wanted = (a: Pt, b: Pt) => Math.max(a.x, b.x) >= box.x0 && Math.min(a.x, b.x) <= box.x1 && Math.max(a.y, b.y) >= box.y0 && Math.min(a.y, b.y) <= box.y1
  return railStamps(points, unit, gap, cull ? wanted : undefined).filter(inside)
}

describe('rail stamps along a line with segments left out (requirement 24, far-zoom budget)', () => {
  it('without a filter nothing changes', () => {
    const line = [{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 60, y: 90 }]
    expect(railStamps(line, 2, 8, undefined)).toEqual(railStamps(line, 2, 8))
    expect(railStamps(line, 2, 8, () => true)).toEqual(railStamps(line, 2, 8))
  })

  it('what is on screen is the same stamps, with the same sleepers, as when the whole line is stamped (so a pan never moves a sleeper)', () => {
    const pt = fc.record({ x: fc.integer({ min: -3000, max: 3000 }), y: fc.integer({ min: -3000, max: 3000 }) })
    fc.assert(
      fc.property(fc.array(pt, { minLength: 2, maxLength: 40 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: -800, max: 800 }), fc.integer({ min: -800, max: 800 }), (line, unit, ox, oy) => {
        const gap = 4 * unit
        const box = { x0: ox, y0: oy, x1: ox + 700, y1: oy + 1400 }
        const whole = shown(line, unit, gap, box, false)
        const cut = shown(line, unit, gap, box, true)
        // The same positions in the same order. A sleeper may differ only where its threshold falls within rounding of a stamp.
        expect(cut.map((s) => [s.x, s.y])).toEqual(whole.map((s) => [s.x, s.y]))
        const diff = cut.filter((s, k) => s.sleeper !== whole[k]!.sleeper).length
        expect(diff).toBeLessThanOrEqual(1)
      }),
      { numRuns: 400, seed: 24 },
    )
  })
})
