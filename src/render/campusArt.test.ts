import { describe, expect, it } from 'vitest'
import { SIGHT_CROWNS } from '../sights/art.ts'
import { Role } from '../sights/campus.ts'
import { SIGHT_KINDS } from '../sights/types.ts'
import artSrc from './campusArt.ts?raw'
import layerSrc from './sightLayer.ts?raw'
import { CAMPUS_STYLE, MASK, OUTLINE_PX, styleFor, tileVariant, VARIANTS, windowRects } from './campusArt.ts'

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

  it('has at least four variants for the kinds with grounds, and every variant looks different', () => {
    for (const k of ['university', 'school', 'hospital'] as const) {
      expect(VARIANTS[k].length, k).toBeGreaterThanOrEqual(4)
      const sig = (i: number) => {
        const s = styleFor(k, i)
        return `${s.pattern}|${s.roof}|${s.wall}|${s.roofKind}`
      }
      expect(new Set(VARIANTS[k].map((_, i) => sig(i))).size, k).toBe(VARIANTS[k].length)
    }
    for (const k of BUILDINGS) expect(VARIANTS[k].length, k).toBeGreaterThanOrEqual(3)
  })

  it('uses roof kinds pitched, flat and terrace across the university variants, none with a house colour', () => {
    const kinds = new Set(VARIANTS.university.map((_, i) => styleFor('university', i).roofKind))
    expect([...kinds].sort()).toEqual(['flat', 'pitched', 'terrace'])
    for (const k of BUILDINGS) for (let i = 0; i < VARIANTS[k].length; i++) for (const h of HOUSE_COLOURS) expect(styleFor(k, i).wall.toLowerCase()).not.toBe(h)
  })

  it('wraps a variant index and draws a 2 px outline', () => {
    expect(styleFor('church', VARIANTS.church.length)).toEqual(styleFor('church', 0))
    expect(OUTLINE_PX).toBe(2)
  })

  it('writes no text on the map: no text calls in the sight painters', () => {
    for (const src of [artSrc, layerSrc]) expect(src).not.toMatch(/fillText|strokeText/)
  })
})
