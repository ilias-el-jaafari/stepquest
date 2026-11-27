import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { labelWidth, layoutLabels, MAX_LABELS, type LabelLine, type LayoutOptions, type Placed } from './labels.ts'

const O: LayoutOptions = { width: 800, height: 800, fontPx: 16, gap: 4, sameNameGap: 320, max: MAX_LABELS }
const line = (text: string, rank: number, ...pts: number[]): LabelLine => ({ text, rank, pts })
const overlap = (a: Placed, b: Placed, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

describe('label layout (requirement 25.6)', () => {
  it('puts a name level on an east-west street and turns it 90° on a north-south one', () => {
    const [h, v] = [layoutLabels([line('Calle Mayor', 3, 0, 400, 800, 400)], O)[0]!, layoutLabels([line('Calle Mayor', 3, 400, 0, 400, 800)], O)[0]!]
    expect(h.vertical).toBe(false)
    expect(h.w).toBe(labelWidth('Calle Mayor', 16))
    expect(h.h).toBe(16)
    expect(v.vertical).toBe(true)
    expect(v.w).toBe(16)
    expect(v.h).toBe(labelWidth('Calle Mayor', 16))
  })

  it('sits on the street: centred on a straight one, inside the window', () => {
    const p = layoutLabels([line('Via', 3, 100, 100, 700, 100)], O)[0]!
    expect(p.x + p.w / 2).toBeCloseTo(400, 0)
    expect(p.y + p.h / 2).toBeCloseTo(100, 0)
  })

  it('skips a street that is shorter than its name, and a street at a steep diagonal', () => {
    expect(layoutLabels([line('Avenida del Cardenal Benlloch', 3, 0, 400, 100, 400)], O)).toHaveLength(0)
    expect(layoutLabels([line('Calle Larga', 3, 100, 100, 500, 500)], O)).toHaveLength(0)
  })

  it('never lets two labels overlap and keeps the gap, the higher class first', () => {
    const lines = [line('Primary Road', 6, 0, 300, 800, 300), line('Minor Street', 3, 0, 306, 800, 306), line('Another One', 3, 0, 500, 800, 500)]
    const placed = layoutLabels(lines, O)
    expect(placed.some((p) => p.text === 'Primary Road')).toBe(true)
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i]!, placed[j]!, O.gap)).toBe(false)
    expect(placed.some((p) => p.text === 'Another One')).toBe(true)
  })

  it('does not repeat a name closer than the same-name gap, but repeats it farther away', () => {
    const close = layoutLabels([line('Calle X', 3, 0, 100, 300, 100), line('Calle X', 3, 0, 160, 300, 160)], O)
    expect(close).toHaveLength(1)
    const far = layoutLabels([line('Calle X', 3, 0, 100, 800, 100), line('Calle X', 3, 0, 700, 800, 700)], O)
    expect(far).toHaveLength(2)
  })

  it('keeps every label wholly inside the window', () => {
    const placed = layoutLabels([line('Calle Larga', 3, -400, 50, 400, 50), line('Otra Calle', 3, 600, 700, 1400, 700)], O)
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(O.width)
      expect(p.y + p.h).toBeLessThanOrEqual(O.height)
    }
  })

  it('follows a bent street: only a straight enough stretch carries the name', () => {
    const bent = line('Carrer Torta', 3, 0, 100, 150, 100, 250, 400, 250, 700)
    const p = layoutLabels([bent], { ...O, width: 400 })[0]
    expect(p).toBeDefined()
  })

  it('caps the count and is the same for any input order', () => {
    const many = Array.from({ length: 200 }, (_, i) => line(`Street ${i}`, i % 5, 0, 4 + i * 4, 800, 4 + i * 4))
    expect(layoutLabels(many, { ...O, gap: 0, max: 7 })).toHaveLength(7)
    const a = layoutLabels(many.slice(0, 40), O)
    const b = layoutLabels([...many.slice(0, 40)].reverse(), O)
    expect(b).toEqual(a)
  })

  it('works with any language: the text is used as it is', () => {
    const p = layoutLabels([line('Улица Ленина', 3, 0, 100, 800, 100), line('大通り', 3, 0, 300, 800, 300)], O)
    expect(p.map((x) => x.text).sort()).toEqual(['Улица Ленина', '大通り'])
  })

  it('property: whatever the streets, no overlap, inside the window, within the cap, names apart', () => {
    const pt = fc.integer({ min: -200, max: 1000 })
    const poly = fc.array(fc.tuple(pt, pt), { minLength: 2, maxLength: 6 }).map((a) => a.flat())
    const name = fc.string({ minLength: 1, maxLength: 14, unit: 'grapheme-ascii' })
    fc.assert(
      fc.property(fc.array(fc.record({ text: name, rank: fc.integer({ min: 1, max: 9 }), pts: poly }), { maxLength: 40 }), (lines) => {
        const placed = layoutLabels(lines, O)
        expect(placed.length).toBeLessThanOrEqual(O.max)
        for (const p of placed) {
          expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= O.width && p.y + p.h <= O.height).toBe(true)
        }
        for (let i = 0; i < placed.length; i++) {
          for (let j = i + 1; j < placed.length; j++) {
            expect(overlap(placed[i]!, placed[j]!, O.gap)).toBe(false)
            if (placed[i]!.text === placed[j]!.text) expect(Math.hypot(placed[i]!.x + placed[i]!.w / 2 - placed[j]!.x - placed[j]!.w / 2, placed[i]!.y + placed[i]!.h / 2 - placed[j]!.y - placed[j]!.h / 2)).toBeGreaterThanOrEqual(O.sameNameGap)
          }
        }
      }),
      { numRuns: 150 },
    )
  })
})
