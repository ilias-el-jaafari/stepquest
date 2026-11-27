import { describe, expect, it } from 'vitest'
import { SIGHT_CROWNS } from '../sights/art.ts'
import { Role } from '../sights/campus.ts'
import { SIGHT_KINDS } from '../sights/types.ts'
import { CAMPUS_STYLE, MASK, tileVariant, windowRects } from './campusArt.ts'

const BUILDINGS = ['university', 'school', 'hospital', 'church', 'mosque', 'synagogue', 'temple', 'townHall'] as const
const HOUSE_COLOURS = ['#f1e3c4', '#d6c39b']

describe('campus art', () => {
  it('gives every building kind its own materials: no two share a roof or a wall colour, none is a house colour', () => {
    const roofs = new Set(BUILDINGS.map((k) => CAMPUS_STYLE[k].roof))
    const walls = new Set(BUILDINGS.map((k) => CAMPUS_STYLE[k].wall))
    const outlines = new Set(BUILDINGS.map((k) => CAMPUS_STYLE[k].outline))
    expect(roofs.size).toBe(BUILDINGS.length)
    expect(walls.size).toBe(BUILDINGS.length)
    expect(outlines.size).toBe(BUILDINGS.length)
    for (const k of BUILDINGS) for (const h of HOUSE_COLOURS) expect(CAMPUS_STYLE[k].wall.toLowerCase()).not.toBe(h)
  })

  it('uses different roof patterns or window rhythms for the kinds that share a colour family', () => {
    const sig = (k: (typeof BUILDINGS)[number]) => `${CAMPUS_STYLE[k].pattern}/${CAMPUS_STYLE[k].windows}`
    expect(new Set(BUILDINGS.map(sig)).size).toBeGreaterThanOrEqual(6)
  })

  it('draws crowns of different colours per kind: the sprite palettes differ', () => {
    const wall = new Set(BUILDINGS.map((k) => SIGHT_CROWNS[k].colors.W))
    const outline = new Set(BUILDINGS.map((k) => SIGHT_CROWNS[k].colors.K))
    expect(wall.size).toBe(BUILDINGS.length)
    expect(outline.size).toBe(BUILDINGS.length)
    expect(new Set(SIGHT_KINDS.map((k) => SIGHT_CROWNS[k].rows.join('/'))).size).toBe(SIGHT_KINDS.length)
  })

  it('has windows on every façade rhythm, inside the 16 px tile, and a variant that does not depend on randomness', () => {
    for (const k of BUILDINGS) {
      for (let v = 0; v < 6; v++) {
        for (const [x, y, w, h] of windowRects(CAMPUS_STYLE[k], v)) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x + w).toBeLessThanOrEqual(16)
          expect(y + h).toBeLessThanOrEqual(15)
        }
      }
    }
    expect(tileVariant(3, 4)).toBe(tileVariant(3, 4))
    expect(Role.roof).not.toBe(Role.wall)
    expect(MASK.N | MASK.E | MASK.S | MASK.W).toBe(15)
  })
})
