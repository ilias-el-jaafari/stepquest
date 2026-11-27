import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { layoutLookup } from '../town/lookup.ts'
import { townFor } from '../town/layout.ts'
import { buildCampus, isBuildingRole, LOT_SHARE, Role, roleAt } from './campus.ts'
import type { SightKind, SightMark } from './types.ts'

const grid = buildTileGrid(loadDemoOsm())
const town = layoutLookup(townFor(grid))
const houseAt = (i: number) => town.houseAt(i)

/** A mark whose area is the tile rectangle [x0, x1) × [y0, y1), in the corners of the tiles. */
function markFor(x0: number, y0: number, x1: number, y1: number, mode: 'grounds' | 'footprint', kind: SightKind = 'university'): SightMark {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => {
    const p = grid.tileToLatLon(x!, y!)
    return [p.lat, p.lon]
  })
  const c = grid.tileToLatLon((x0 + x1) / 2, (y0 + y1) / 2)
  return { id: `${kind}:${x0}:${y0}`, kind, lat: c.lat, lon: c.lon, alongM: 0, lateralM: 0, area: { mode, rings: [ring] } }
}

const isStreet = (t: number | undefined) => t === Terrain.road || t === Terrain.path || t === Terrain.crossing || t === Terrain.water || t === Terrain.plaza

const rect = fc.record({ x: fc.integer({ min: 8, max: grid.cols - 60 }), y: fc.integer({ min: 8, max: grid.rows - 60 }), w: fc.integer({ min: 1, max: 40 }), h: fc.integer({ min: 1, max: 40 }) })

describe('buildCampus', () => {
  it('has no campus without an area', () => {
    expect(buildCampus(grid, houseAt, { id: 'x', kind: 'school', lat: 39.5, lon: -0.4, alongM: 0, lateralM: 0 })).toBeUndefined()
  })

  it('grounds: building tiles inside become roof and façade, the rest campus ground, streets stay as they are', () => {
    const c = buildCampus(grid, houseAt, markFor(20, 20, 70, 70, 'grounds'))!
    expect(c).toBeDefined()
    let roof = 0
    let wall = 0
    let ground = 0
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        const r = roleAt(c, gx, gy)
        const t = grid.terrain[grid.index(gx, gy)]
        if (isStreet(t)) expect(r).toBe(Role.none)
        if (r === Role.roof) roof++
        if (r === Role.wall) wall++
        if (r === Role.lawn || r === Role.paving || r === Role.tree) ground++
      }
    }
    expect(roof + wall).toBeGreaterThan(0)
    expect(wall).toBeGreaterThan(0)
    expect(ground).toBeGreaterThan(0)
  })

  it('a façade row is a building tile with no building to its south, a roof tile has one', () => {
    const c = buildCampus(grid, houseAt, markFor(20, 20, 70, 70, 'grounds'))!
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        const r = roleAt(c, gx, gy)
        if (r === Role.roof) expect(isBuildingRole(roleAt(c, gx, gy + 1))).toBe(true)
        if (r === Role.wall) expect(isBuildingRole(roleAt(c, gx, gy + 1))).toBe(false)
      }
    }
  })

  it('property (grounds, any rectangle): special tiles only on building tiles inside the grounds or in a replaced lot; no ordinary house is left half covered', () => {
    fc.assert(
      fc.property(rect, ({ x, y, w, h }) => {
        const c = buildCampus(grid, houseAt, markFor(x, y, x + w, y + h, 'grounds'))
        if (!c) return
        const seen = new Set<unknown>()
        for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
          for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
            const r = roleAt(c, gx, gy)
            const i = grid.index(gx, gy)
            if (isBuildingRole(r)) expect(grid.terrain[i]).toBe(Terrain.building)
            const house = houseAt(i)
            const inRect = gx >= x && gx < x + w && gy >= y && gy < y + h
            // Outside the rectangle only whole lots may be covered.
            if (r !== Role.none && !inRect) expect(house).toBeDefined()
            if (house && !seen.has(house)) {
              seen.add(house)
              let covered = 0
              let total = 0
              for (let j = house.y; j < house.y + house.h; j++) {
                for (let k = house.x; k < house.x + house.w; k++) {
                  if (isStreet(grid.terrain[grid.index(k, j)])) continue
                  total++
                  if (roleAt(c, k, j) !== Role.none) covered++
                }
              }
              expect(covered === 0 || covered === total, `house ${house.x},${house.y}`).toBe(true)
            }
          }
        }
      }),
      { numRuns: 60 },
    )
  })

  it('property (grounds): every lot with at least a third inside the rectangle is replaced whole', () => {
    fc.assert(
      fc.property(rect, ({ x, y, w, h }) => {
        const c = buildCampus(grid, houseAt, markFor(x, y, x + w, y + h, 'grounds'))
        if (!c) return
        const houses = new Set<NonNullable<ReturnType<typeof houseAt>>>()
        for (let gy = y; gy < y + h; gy++) for (let gx = x; gx < x + w; gx++) {
          const hs = houseAt(grid.index(gx, gy))
          if (hs) houses.add(hs)
        }
        for (const hs of houses) {
          let inn = 0
          for (let j = hs.y; j < hs.y + hs.h; j++) for (let k = hs.x; k < hs.x + hs.w; k++) if (k >= x && k < x + w && j >= y && j < y + h && !isStreet(grid.terrain[grid.index(k, j)])) inn++
          if (inn < hs.w * hs.h * LOT_SHARE + 1) continue
          for (let j = hs.y; j < hs.y + hs.h; j++) for (let k = hs.x; k < hs.x + hs.w; k++) if (!isStreet(grid.terrain[grid.index(k, j)])) expect(roleAt(c, k, j)).not.toBe(Role.none)
        }
      }),
      { numRuns: 40 },
    )
  })

  it('property (footprint, any rectangle): building tiles only inside the footprint, whole footprint covered except streets', () => {
    fc.assert(
      fc.property(rect, ({ x, y, w, h }) => {
        const c = buildCampus(grid, houseAt, markFor(x, y, x + w, y + h, 'footprint', 'church'))
        if (!c) return
        for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
          for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
            const r = roleAt(c, gx, gy)
            const inRect = gx >= x && gx < x + w && gy >= y && gy < y + h
            if (isBuildingRole(r)) expect(inRect).toBe(true)
            if (inRect && !isStreet(grid.terrain[grid.index(gx, gy)])) expect(isBuildingRole(r)).toBe(true)
          }
        }
      }),
      { numRuns: 60 },
    )
  })

  it('works for a non-rectangular footprint (an L) and gives it one main building and a crown', () => {
    // Find open ground (no street, no building) big enough, so the L is fully loaded land.
    let spot: { x: number; y: number } | undefined
    outer: for (let y = 5; y < grid.rows - 20; y++) {
      for (let x = 5; x < grid.cols - 20; x++) {
        let ok = true
        for (let j = 0; j < 12 && ok; j++) for (let i = 0; i < 12; i++) if (isStreet(grid.terrain[grid.index(x + i, y + j)]) || houseAt(grid.index(x + i, y + j))) { ok = false; break }
        if (ok) { spot = { x, y }; break outer }
      }
    }
    expect(spot).toBeDefined()
    const { x, y } = spot!
    const px = (a: number, b: number) => grid.tileToLatLon(x + a, y + b)
    const pts = [px(0, 0), px(10, 0), px(10, 4), px(4, 4), px(4, 10), px(0, 10)]
    const ring = pts.flatMap((p) => [p.lat, p.lon])
    const c = px(2, 2)
    const mark: SightMark = { id: 'L', kind: 'townHall', lat: c.lat, lon: c.lon, alongM: 0, lateralM: 0, area: { mode: 'footprint', rings: [ring] } }
    const campus = buildCampus(grid, houseAt, mark)!
    expect(campus.buildings).toHaveLength(1)
    expect(campus.main).toBe(0)
    expect(campus.crown).toBeDefined()
    // The notch of the L is empty.
    expect(roleAt(campus, x + 7, y + 7)).toBe(Role.none)
    expect(isBuildingRole(roleAt(campus, x + 2, y + 8))).toBe(true)
    // The crown stands on the footprint's southernmost row, within the group.
    const cr = campus.crown!
    expect(isBuildingRole(roleAt(campus, Math.floor(cr.x), cr.y - 1))).toBe(true)
  })

  it('is deterministic', () => {
    const m = markFor(20, 20, 60, 60, 'grounds')
    const a = buildCampus(grid, houseAt, m)!
    const b = buildCampus(grid, houseAt, m)!
    expect(Array.from(a.roles)).toEqual(Array.from(b.roles))
    expect(a.crown).toEqual(b.crown)
  })
})
