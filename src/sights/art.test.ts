import { describe, expect, it } from 'vitest'
import { HOUSE_FOOTPRINT_PX, SIGHT, SIGHT_BODIES, SIGHT_LIT, SIGHT_LIT_SPRITES, SIGHT_SPRITES, sightAtlasLayout, spriteSize, starRows } from './art.ts'
import { isMonumentKind, SIGHT_KINDS } from './types.ts'

describe('sight art', () => {
  it('has one rectangular sprite per kind, in the palette, with an ink outline and no stray colours', () => {
    for (const k of SIGHT_KINDS) {
      const s = SIGHT_SPRITES[k]
      const w = s.rows[0]!.length
      expect(s.rows.every((r) => r.length === w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(40)
      expect(w).toBeLessThanOrEqual(80)
      expect(s.rows.length).toBeLessThanOrEqual(80)
      for (const ch of s.rows.join('')) if (ch !== '.') expect(SIGHT[ch], `${k}: ${ch}`).toBeDefined()
      // The outline closes the silhouette of the building itself (the paving plate has none).
      const body = SIGHT_BODIES[k]
      expect(body[0]!.replace(/[.K]/g, '')).toBe('')
      expect(body.at(-1)!.replace(/[.K]/g, '')).toBe('')
      expect(body.every((r) => r[0] === '.' || r[0] === 'K')).toBe(true)
    }
  })

  it('stands out from the houses (task 91.5): buildings cover about 1.6 to 2 house footprints, monuments rise to three tiles or more', () => {
    for (const k of SIGHT_KINDS) {
      const { w, h } = spriteSize(k)
      if (isMonumentKind(k)) expect(Math.max(h, w), k).toBeGreaterThanOrEqual(48)
      else {
        expect((w * h) / HOUSE_FOOTPRINT_PX, k).toBeGreaterThanOrEqual(1.5)
        expect((w * h) / HOUSE_FOOTPRINT_PX, k).toBeLessThanOrEqual(2.6)
      }
    }
  })

  it('stands each sight on a paving plate along its foot, and keeps the building above it', () => {
    for (const k of SIGHT_KINDS) {
      const rows = SIGHT_SPRITES[k].rows
      const last = rows.at(-1)!
      expect(last, k).toContain('Q')
      // The plate spans wider than the building body, and the body sits on it.
      const bodyW = SIGHT_BODIES[k][0]!.length
      expect(last.replace(/\./g, '').length, k).toBeGreaterThan(bodyW * 0.8)
      expect(rows[0]!.replace(/[.]/g, ''), k).not.toContain('Q')
    }
  })

  it('has windows on the buildings that light up at night, and nothing else in the overlay', () => {
    for (const k of ['university', 'school', 'hospital', 'church', 'mosque', 'townHall'] as const) {
      expect(SIGHT_LIT_SPRITES[k].rows.join('')).toContain('Y')
    }
    for (const k of SIGHT_KINDS) {
      const lit = SIGHT_LIT_SPRITES[k]
      expect(lit.rows).toHaveLength(SIGHT_SPRITES[k].rows.length)
      for (const ch of lit.rows.join('')) expect(['.', 'Y']).toContain(ch)
      expect(lit.colors.Y).toBe(SIGHT_LIT)
    }
  })

  it('draws the star of David symmetric, six-pointed and open to the sides', () => {
    const rows = starRows()
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(r).toBe([...r].reverse().join(''))
    expect(rows.join('')).not.toContain('..G..G..')
    expect(SIGHT_SPRITES.synagogue.rows.join('')).toContain('GGGGGGGGG')
  })

  it('packs every day sprite and lit overlay into the atlas without overlap', () => {
    const l = sightAtlasLayout()
    const slots = [...SIGHT_KINDS.map((k) => l.day[k]), ...SIGHT_KINDS.map((k) => l.lit[k])]
    expect(slots).toHaveLength(SIGHT_KINDS.length * 2)
    for (const s of slots) {
      expect(s.x + s.w).toBeLessThanOrEqual(l.width)
      expect(s.y + s.h).toBeLessThanOrEqual(l.height)
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!
        const b = slots[j]!
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
      }
    }
    for (const k of SIGHT_KINDS) expect({ w: l.day[k].w, h: l.day[k].h }).toEqual(spriteSize(k))
    expect(l.width * l.height).toBeLessThan(160_000)
  })

  it('draws each kind differently', () => {
    expect(new Set(SIGHT_KINDS.map((k) => SIGHT_SPRITES[k].rows.join('/'))).size).toBe(SIGHT_KINDS.length)
  })
})
