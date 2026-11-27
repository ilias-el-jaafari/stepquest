import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fitLabel } from './labelFit.ts'

describe('fitLabel', () => {
  it('keeps a centred label where it is', () => {
    expect(fitLabel(200, 100, 150, 120, 10, 390, 844, 4, 3)).toEqual({ x: 200, y: 153 })
  })
  it('slides a label cut by the left or right edge back inside', () => {
    expect(fitLabel(20, 100, 150, 120, 10, 390, 844, 4, 3).x).toBe(64)
    expect(fitLabel(380, 100, 150, 120, 10, 390, 844, 4, 3).x).toBe(326)
  })
  it('puts the label above the sprite when there is no room below', () => {
    expect(fitLabel(200, 700, 840, 120, 10, 390, 844, 4, 3).y).toBe(687)
  })
  it('property: the label box is always inside the view when it fits', () => {
    fc.assert(
      fc.property(fc.integer({ min: -300, max: 700 }), fc.integer({ min: -100, max: 950 }), fc.integer({ min: 20, max: 300 }), (cx, top, textW) => {
        const f = fitLabel(cx, top, top + 80, textW, 10, 390, 844, 4, 3)
        expect(f.x - textW / 2).toBeGreaterThanOrEqual(4)
        expect(f.x + textW / 2).toBeLessThanOrEqual(386)
        expect(f.y).toBeGreaterThanOrEqual(4)
        expect(f.y + 10).toBeLessThanOrEqual(840)
      }),
    )
  })
})
