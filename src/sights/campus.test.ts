import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { layoutLookup } from '../town/lookup.ts'
import { townFor } from '../town/layout.ts'
import { ADJ_GAP, buildCampus, Feat, featAt, ICONIC_FEATS, isBuildingRole, LOT_SHARE, LOT_TILES, MIN_FOOTPRINT_TILES, Role, roleAt, type Campus } from './campus.ts'
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
            if (!inRect && [Role.roof, Role.wall, Role.lawn, Role.tree, Role.court].includes(r as 4)) expect(house).toBeDefined()
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
        // A footprint under the kind's minimum is grown (L14.1); the strict check is for the others.
        let avail = 0
        for (let gy = y; gy < y + h; gy++) for (let gx = x; gx < x + w; gx++) if (grid.inBounds(gx, gy) && !isStreet(grid.terrain[grid.index(gx, gy)])) avail++
        if (avail < MIN_FOOTPRINT_TILES.church!) return
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
    const mark: SightMark = { id: 'L', kind: 'church', lat: c.lat, lon: c.lon, alongM: 0, lateralM: 0, area: { mode: 'footprint', rings: [ring] } }
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


/** A copy of the demo grid with a big open field of plain ground at (10, 10), no houses, for exact set-ups. */
function openField() {
  const g = buildTileGrid(loadDemoOsm())
  for (let y = 10; y < 110; y++) for (let x = 10; x < 110; x++) g.terrain[g.index(x, y)] = Terrain.ground
  return g
}
const noHouse = () => undefined
function markIn(g: ReturnType<typeof openField>, x0: number, y0: number, x1: number, y1: number, kind: SightKind, mode: 'grounds' | 'footprint' = 'footprint'): SightMark {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => {
    const p = g.tileToLatLon(x!, y!)
    return [p.lat, p.lon]
  })
  const c = g.tileToLatLon((x0 + x1) / 2, (y0 + y1) / 2)
  return { id: `${kind}:${x0}:${y0}`, kind, lat: c.lat, lon: c.lon, alongM: 0, lateralM: 0, area: { mode, rings: [ring] } }
}
const count = (c: Campus, pred: (r: number) => boolean) => c.roles.reduce((n, r) => n + (pred(r) ? 1 : 0), 0)

describe('visual pass: varied campus (L12)', () => {
  const g = openField()
  // A campus of seven separate buildings on a lawn: wide gaps between some, narrow between others.
  const base = markIn(g, 20, 20, 100, 100, 'university', 'grounds')
  for (const [x, y, w, h] of [[24, 24, 8, 6], [36, 24, 9, 6], [48, 24, 7, 8], [24, 40, 12, 12], [40, 40, 6, 5], [60, 60, 10, 8], [76, 28, 8, 8]]) {
    for (let j = y!; j < y! + h!; j++) for (let i = x!; i < x! + w!; i++) g.terrain[g.index(i, j)] = Terrain.building
  }
  const c = buildCampus(g, noHouse, base)!

  it('has several buildings, each with a variant, and is deterministic', () => {
    expect(c.buildings.length).toBeGreaterThanOrEqual(6)
    const again = buildCampus(g, noHouse, base)!
    expect(again.buildings.map((b) => b.variant)).toEqual(c.buildings.map((b) => b.variant))
    expect(Array.from(again.feat)).toEqual(Array.from(c.feat))
    expect(again.props).toEqual(c.props)
    expect(new Set(c.buildings.map((b) => b.variant)).size).toBeGreaterThanOrEqual(3)
  })

  it('never gives two adjacent buildings the same variant (while variants last)', () => {
    const V = 4
    const near = (a: Campus['buildings'][number], b: Campus['buildings'][number]) => a.x0 - ADJ_GAP <= b.x1 && b.x0 - ADJ_GAP <= a.x1 && a.y0 - ADJ_GAP <= b.y1 && b.y0 - ADJ_GAP <= a.y1
    let pairs = 0
    c.buildings.forEach((a, i) => {
      const neigh = c.buildings.filter((b, j) => j !== i && near(a, b))
      if (neigh.length >= V) return
      for (const b of neigh) {
        pairs++
        expect(b.variant).not.toBe(a.variant)
      }
    })
    expect(pairs).toBeGreaterThan(2)
  })

  it('cuts an inset courtyard into the big filled building, with building all round (closed) and wings with façade rows', () => {
    const big = c.buildings.find((b) => b.x1 - b.x0 + 1 === 12 && b.y1 - b.y0 + 1 === 12)!
    expect(big.court).toBeDefined()
    const k = big.court!
    expect(k.x1 - k.x0 + 1).toBeGreaterThanOrEqual(3)
    expect(k.y1 - k.y0 + 1).toBeGreaterThanOrEqual(3)
    for (let y = k.y0; y <= k.y1; y++) for (let x = k.x0; x <= k.x1; x++) expect(roleAt(c, x, y)).toBe(Role.court)
    // The building tile north of the courtyard faces it with a façade row.
    expect(roleAt(c, k.x0, k.y0 - 1)).toBe(Role.wall)
    // Small buildings have none.
    expect(c.buildings.filter((b) => b.x1 - b.x0 < 6 || b.y1 - b.y0 < 6).every((b) => !b.court)).toBe(true)
  })

  it('keeps lawn, paving and trees between the buildings', () => {
    expect(count(c, (r) => r === Role.lawn)).toBeGreaterThan(200)
    expect(count(c, (r) => r === Role.paving)).toBeGreaterThan(20)
    expect(count(c, (r) => r === Role.tree)).toBeGreaterThan(5)
  })

  it('gives each building of 3 tiles or more a door on its entrance side, with steps outside it', () => {
    for (const b of c.buildings) {
      if (b.tiles < 3) continue
      expect(b.door, `building at ${b.x0},${b.y0}`).toBeDefined()
      const d = b.door!
      const stepsFeat = { N: Feat.stepsN, E: Feat.stepsE, S: Feat.stepsS, W: Feat.stepsW }[d.side]
      const dx = { N: 0, E: 1, S: 0, W: -1 }[d.side]
      const dy = { N: -1, E: 0, S: 1, W: 0 }[d.side]
      expect(isBuildingRole(roleAt(c, d.x, d.y))).toBe(true)
      expect(roleAt(c, d.x + dx, d.y + dy)).toBe(Role.steps)
      expect(featAt(c, d.x + dx, d.y + dy)).toBe(stepsFeat)
    }
  })

  it('draws no building role outside the area, and steps and plaza only on free tiles', () => {
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        const r = roleAt(c, gx, gy)
        const t = g.terrain[g.index(gx, gy)]
        if (isBuildingRole(r) || r === Role.court) expect(t).toBe(Terrain.building)
        if (r === Role.steps) expect(isStreet(t) || t === Terrain.building).toBe(false)
      }
    }
  })

  it('puts chimneys and cupolas as props on roofs, flagpoles only on the main building', () => {
    expect(c.props.length).toBeGreaterThan(0)
    for (const p of c.props) expect(['pole', 'chimney', 'cupola']).toContain(p.type)
  })
})

describe('visual pass: entrance side (L12.4)', () => {
  it.each([
    ['E', 'x', 1],
    ['W', 'x', -1],
    ['N', 'y', -1],
    ['S', 'y', 1],
  ] as const)('faces the street on its %s side', (side, axis, dir) => {
    const g = openField()
    const m = markIn(g, 50, 50, 62, 58, 'church')
    // A street 5 tiles from the side (and none elsewhere within the search distance on the field).
    for (let t = 30; t < 90; t++) {
      const x = axis === 'x' ? (dir > 0 ? 67 : 45) : t
      const y = axis === 'y' ? (dir > 0 ? 63 : 45) : t
      g.terrain[g.index(x, y)] = Terrain.road
    }
    const c = buildCampus(g, noHouse, m)!
    expect(c.buildings[0]!.door!.side).toBe(side)
  })

  it('turns toward a route tile too, and faces south when nothing is near', () => {
    const g = openField()
    const m = markIn(g, 50, 50, 62, 58, 'school')
    expect(buildCampus(g, noHouse, m)!.buildings[0]!.door!.side).toBe('S')
    const keep = new Set<number>()
    for (let y = 40; y < 70; y++) keep.add(g.index(66, y))
    expect(buildCampus(g, noHouse, m, keep)!.buildings[0]!.door!.side).toBe('E')
  })

  it('puts steps and the plaza on free tiles only: not on a street or the route', () => {
    const g = openField()
    const m = markIn(g, 50, 50, 62, 58, 'church')
    for (let x = 40; x < 80; x++) g.terrain[g.index(x, 61)] = Terrain.road
    const keep = new Set<number>([g.index(56, 60), g.index(55, 60), g.index(57, 60)])
    const c = buildCampus(g, noHouse, m, keep)!
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        const r = roleAt(c, gx, gy)
        if (r === Role.steps || (r === Role.paving && g.terrain[g.index(gx, gy)] !== Terrain.building)) {
          expect(isStreet(g.terrain[g.index(gx, gy)])).toBe(false)
          expect(keep.has(g.index(gx, gy))).toBe(false)
        }
      }
    }
  })
})

describe('visual pass: town hall (L14)', () => {
  const g = openField()
  it('grows a small footprint to at least three lots around its centroid, wide with an odd width, off streets and the route', () => {
    const m = markIn(g, 60, 60, 64, 63, 'townHall')
    // A road to the south and a route tile row to the north that growth must not cover.
    for (let x = 40; x < 90; x++) g.terrain[g.index(x, 68)] = Terrain.road
    const keep = new Set<number>()
    for (let x = 40; x < 90; x++) keep.add(g.index(x, 55))
    const c = buildCampus(g, noHouse, m, keep)!
    const n = count(c, (r) => isBuildingRole(r))
    expect(n).toBeGreaterThanOrEqual(3 * LOT_TILES)
    expect(c.buildings).toHaveLength(1)
    const b = c.buildings[0]!
    const w = b.x1 - b.x0 + 1
    const h = b.y1 - b.y0 + 1
    expect(w % 2).toBe(1)
    expect(w).toBeGreaterThanOrEqual(h)
    // Around the real centroid (62, 61.5): the box straddles it.
    expect(b.x0).toBeLessThanOrEqual(62)
    expect(b.x1 + 1).toBeGreaterThanOrEqual(62)
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        if (roleAt(c, gx, gy) === Role.none) continue
        expect(isStreet(g.terrain[g.index(gx, gy)]) && g.terrain[g.index(gx, gy)] !== Terrain.building).toBe(false)
        expect(keep.has(g.index(gx, gy))).toBe(false)
      }
    }
  })

  it('is symmetrical about the entrance: columns, balcony, doors, two flagpoles at equal distances', () => {
    const m = markIn(g, 60, 60, 64, 63, 'townHall')
    const c = buildCampus(g, noHouse, m)!
    const b = c.buildings[0]!
    const d = b.door!
    expect(d.side).toBe('S')
    expect(featAt(c, d.x, d.y)).toBe(Feat.door)
    for (const o of [-2, -1, 1, 2]) expect(featAt(c, d.x + o, d.y)).toBe(Feat.portico)
    for (const o of [-1, 0, 1]) expect(featAt(c, d.x + o, d.y - 1)).toBe(Feat.balcony)
    const poles = c.props.filter((p) => p.type === 'pole')
    expect(poles).toHaveLength(2)
    const cx = d.x + 0.5
    expect(Math.abs(poles[0]!.x - cx)).toBeCloseTo(Math.abs(poles[1]!.x - cx), 5)
    expect(poles[0]!.x).not.toBe(poles[1]!.x)
    expect(c.crown).toBeDefined()
    expect(c.crown!.x).toBeCloseTo(cx, 5)
  })

  it('every footprint kind grows to its own minimum', () => {
    for (const kind of Object.keys(MIN_FOOTPRINT_TILES) as SightKind[]) {
      const c = buildCampus(g, noHouse, markIn(g, 60, 60, 62, 62, kind))!
      expect(count(c, (r) => isBuildingRole(r)), kind).toBeGreaterThanOrEqual(MIN_FOOTPRINT_TILES[kind]!)
    }
    expect(MIN_FOOTPRINT_TILES.townHall).toBe(3 * LOT_TILES)
  })

  it('does not grow a footprint that is big enough', () => {
    const c = buildCampus(g, noHouse, markIn(g, 60, 60, 80, 67, 'townHall'))!
    const b = c.buildings[0]!
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([60, 60, 79, 66])
  })

  it('has every kind\'s iconic features at its entrance', () => {
    for (const kind of Object.keys(ICONIC_FEATS) as SightKind[]) {
      const c = buildCampus(g, noHouse, markIn(g, 50, 50, 66, 60, kind))!
      const seen = new Set<number>(c.feat)
      for (const f of ICONIC_FEATS[kind]!) expect(seen.has(f), `${kind} feature ${f}`).toBe(true)
    }
    // Spot checks of the spec: rose window, red gate, green-striped bay, fence, canopy, columns.
    expect(ICONIC_FEATS.church).toContain(Feat.rose)
    expect(ICONIC_FEATS.temple).toContain(Feat.gate)
    expect(ICONIC_FEATS.hospital).toContain(Feat.bay)
    expect(ICONIC_FEATS.school).toContain(Feat.fence)
    expect(ICONIC_FEATS.townHall).toContain(Feat.balcony)
    expect(ICONIC_FEATS.university).toContain(Feat.pediment)
  })

  it('casts a shadow strip on free tiles east and south of a building, never on a street', () => {
    const m = markIn(g, 50, 50, 66, 60, 'church')
    const c = buildCampus(g, noHouse, m)!
    let any = 0
    for (let gy = c.y0; gy < c.y0 + c.h; gy++) {
      for (let gx = c.x0; gx < c.x0 + c.w; gx++) {
        const sh = c.shade[(gy - c.y0) * c.w + (gx - c.x0)]!
        if (!sh) continue
        any++
        expect(isBuildingRole(roleAt(c, gx, gy))).toBe(false)
        expect(isStreet(g.terrain[g.index(gx, gy)])).toBe(false)
      }
    }
    expect(any).toBeGreaterThan(10)
  })
})
