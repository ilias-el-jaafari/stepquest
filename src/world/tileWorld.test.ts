import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { cellBBox, cellKey, cellOf } from './cells.ts'
import { sliceToCells } from './slice.ts'
import { makeRecord } from './testing.ts'
import { clipRails, TileWorld } from './tileWorld.ts'

const records = sliceToCells(loadDemoOsm())
const centre = cellOf(DEMO_AREA.center)

function paintAll(order = records) {
  const tw = new TileWorld(centre)
  for (const r of order) tw.paint(r)
  return tw
}

const forward = paintAll()

/** Every structure of the world, found through the per-chunk lookup. */
function structures(tw: TileWorld) {
  const size = 32
  const houses = new Set<string>()
  const landmarks = new Set<string>()
  for (let cy = 0; cy * size < tw.grid.rows; cy++) {
    for (let cx = 0; cx * size < tw.grid.cols; cx++) {
      const s = tw.town.structuresIn(cx, cy, size)
      for (const h of s?.houses ?? []) houses.add(`${h.x},${h.y},${h.w},${h.h},${h.roof}`)
      for (const l of s?.landmarks ?? []) landmarks.add(`${l.kind}:${l.x},${l.y},${l.w},${l.h}`)
    }
  }
  return { houses: [...houses].sort(), landmarks: [...landmarks].sort() }
}

describe('tile world (19.9, 19.10)', () => {
  it('puts the frame on cell borders and lets the cells partition it', () => {
    const g = forward.grid
    expect(g.bbox.north).toBeCloseTo(cellBBox({ i: centre.i + 4, j: 0 }).north, 9)
    let area = 0
    for (let i = forward.i0; i <= forward.i1; i++) {
      for (let j = forward.j0; j <= forward.j1; j++) {
        const r = forward.ownedRect({ i, j })!
        area += r.w * r.h
        const right = forward.ownedRect({ i, j: j + 1 })
        if (right) expect(right.x).toBe(r.x + r.w)
        const below = forward.ownedRect({ i: i - 1, j })
        if (below) expect(below.y).toBe(r.y + r.h)
      }
    }
    expect(area).toBe(g.cols * g.rows)
    expect(forward.ownedRect({ i: centre.i + 5, j: centre.j })).toBeUndefined()
  })

  it('gives the same tiles and town whatever order the cells arrive in', () => {
    const back = paintAll([...records].reverse())
    for (const k of ['layers', 'terrain', 'style', 'barrier', 'bridge', 'covered'] as const) expect(back.grid[k]!.every((v, i) => v === forward.grid[k]![i])).toBe(true)
    expect(structures(back)).toEqual(structures(forward))
    expect(back.grid.rails.length).toBe(forward.grid.rails.length)
  })

  it('paints the tiles of a cell from its own data only (no seam work when a neighbour arrives)', () => {
    const one = records.find((r) => r.cell.i === centre.i && r.cell.j === centre.j)!
    const alone = new TileWorld(centre)
    alone.paint(one)
    const rect = alone.ownedRect(one.cell)!
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = alone.grid.index(x, y)
        expect(alone.grid.terrain[i]).toBe(forward.grid.terrain[i])
        expect(alone.grid.layers[i]).toBe(forward.grid.layers[i])
        // Houses this cell builds are the same with its neighbours around; neighbours may add the part of
        // their own buildings that reaches in (a building belongs to the cell that holds its centre).
        const own = alone.town.houseAt(i)
        if (own) expect(forward.town.houseAt(i)?.seed).toBe(own.seed)
      }
    }
    // Nothing outside the cell is covered.
    expect(alone.grid.coveredAt(rect.x - 1, rect.y)).toBe(false)
    expect(alone.grid.coveredAt(rect.x, rect.y)).toBe(true)
  })

  it('keeps landmarks on the tiles of their own cell, lets houses of a building reach into the next cell, and no two overlap', () => {
    const taken = new Map<number, string>()
    const { houses, landmarks } = structures(forward)
    expect(houses.length).toBeGreaterThan(1000)
    expect(landmarks.length).toBeGreaterThan(5)
    let crossing = 0
    for (const s of landmarks) {
      const [x, y, w, h] = s.replace(/^[a-zA-Z]+:/, '').split(',').map(Number) as [number, number, number, number]
      const rect = forward.ownedRect(cellOf(forward.grid.tileToLatLon(x + 0.5, y + 0.5)))!
      expect(x + w).toBeLessThanOrEqual(rect.x + rect.w)
      expect(y + h).toBeLessThanOrEqual(rect.y + rect.h)
    }
    for (const s of [...houses, ...landmarks]) {
      const [x, y, w, h] = s.replace(/^[a-zA-Z]+:/, '').split(',').map(Number) as [number, number, number, number]
      const rect = forward.ownedRect(cellOf(forward.grid.tileToLatLon(x + 0.5, y + 0.5)))!
      if (x + w > rect.x + rect.w || y + h > rect.y + rect.h || x < rect.x || y < rect.y) crossing++
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const i = forward.grid.index(xx, yy)
          expect(taken.get(i)).toBeUndefined()
          taken.set(i, s)
        }
    }
    // Some houses of the demo reach across a cell line: that is the whole-building rule at work.
    expect(crossing).toBeGreaterThan(0)
  })

  it('draws about the same map as the single extract', () => {
    const single = buildTileGrid(loadDemoOsm())
    const histogram = (t: Uint8Array) => {
      const h = new Array(8).fill(0)
      for (const v of t) h[v]++
      return h
    }
    const a = histogram(single.terrain)
    const b = histogram(forward.grid.terrain.filter((_, i) => forward.grid.covered![i] === 1))
    for (const t of [Terrain.road, Terrain.building, Terrain.park, Terrain.water, Terrain.path]) expect(Math.abs(b[t] - a[t]) / a[t]).toBeLessThan(0.03)
  })

  it('clears a dropped cell and tells listeners the rectangle, one tile wider', () => {
    const tw = paintAll()
    const seen: unknown[] = []
    tw.subscribe((r) => seen.push(r))
    const own = tw.ownedRect(centre)!
    tw.clear(centre)
    // At least the cell, one tile wider (more when houses of its buildings reached into a neighbour).
    expect(seen).toHaveLength(1)
    const r = seen[0] as { x: number; y: number; w: number; h: number }
    expect(r.x).toBeLessThanOrEqual(own.x - 1)
    expect(r.y).toBeLessThanOrEqual(own.y - 1)
    expect(r.x + r.w).toBeGreaterThanOrEqual(own.x + own.w + 1)
    expect(r.y + r.h).toBeGreaterThanOrEqual(own.y + own.h + 1)
    expect(tw.grid.coveredAt(own.x + 3, own.y + 3)).toBe(false)
    expect(tw.grid.terrainAt(own.x + 3, own.y + 3)).toBe(Terrain.ground)
    expect(tw.town.houseAt(tw.grid.index(own.x + 3, own.y + 3))).toBeUndefined()
    expect(cellKey(centre)).toBe(`${centre.i},${centre.j}`)
  })

  it('clips track polylines to a rectangle', () => {
    expect(clipRails([[{ x: -5, y: 5 }, { x: 5, y: 5 }, { x: 15, y: 5 }]], { x: 0, y: 0, w: 10, h: 10 })).toEqual([[{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }]])
    expect(clipRails([[{ x: -5, y: 5 }, { x: -1, y: 5 }]], { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })

  it('paints a coarse record as tiles only (no houses), and the detail record replaces it', () => {
    const rec = records.find((r) => r.cell.i === centre.i && r.cell.j === centre.j)!
    const coarseData = { ...rec.data, ways: rec.data.ways.filter((w) => w.kind === 'road'), pois: [], activity: [], industrial: [] }
    const tw = new TileWorld(centre)
    const own = tw.ownedRect(rec.cell)!
    tw.paint({ ...rec, data: coarseData }, { coarse: true })
    let roads = 0
    let houses = 0
    for (let y = own.y; y < own.y + own.h; y++) {
      for (let x = own.x; x < own.x + own.w; x++) {
        if (tw.grid.terrainAt(x, y) === Terrain.road) roads++
        if (tw.town.houseAt(tw.grid.index(x, y))) houses++
      }
    }
    expect(roads).toBeGreaterThan(500)
    expect(houses).toBe(0)
    expect(tw.grid.coveredAt(own.x + 3, own.y + 3)).toBe(true)
    tw.paint(rec)
    let after = 0
    for (let y = own.y; y < own.y + own.h; y++) for (let x = own.x; x < own.x + own.w; x++) if (tw.town.houseAt(tw.grid.index(x, y))) after++
    expect(after).toBeGreaterThan(100)
  })
})

describe('whole buildings at a cell border (requirement 20.11)', () => {
  const A = { i: 3949, j: -40 }
  const B = { i: 3949, j: -39 }
  const at = (lat: number, lon: number): [number, number] => [lat, lon]
  /** A 100 m × 45 m building across the border at lon -0.39, its centre in A, whole in both records. */
  const way = { id: 7, kind: 'building' as const, area: true, pts: [at(39.495, -0.3908), at(39.495, -0.3896), at(39.4954, -0.3896), at(39.4954, -0.3908), at(39.495, -0.3908)] }
  const recA = makeRecord(A, [way])
  const recB = makeRecord(B, [way])

  const houseTiles = (tw: TileWorld, cell: typeof A) => {
    const r = tw.ownedRect(cell)!
    let n = 0
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (tw.town.houseAt(tw.grid.index(x, y))) n++
    return n
  }
  const buildingTiles = (tw: TileWorld, cell: typeof A) => {
    const r = tw.ownedRect(cell)!
    let n = 0
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (tw.grid.terrainAt(x, y) === Terrain.building) n++
    return n
  }

  it('lays the building out once, whole, from the cell that holds its centre, so its houses reach into the neighbour', () => {
    const tw = new TileWorld(A)
    tw.paint(recA)
    // The neighbour is not loaded: the owner still builds the part on the neighbour's side.
    const east = tw.ownedRect(B)!
    let reaching = 0
    for (let y = east.y; y < east.y + east.h; y++) for (let x = east.x; x < east.x + 8; x++) if (tw.town.houseAt(tw.grid.index(x, y))) reaching++
    expect(reaching).toBeGreaterThan(10)
    // And the other way round: the neighbour alone does not build it.
    const only = new TileWorld(A)
    only.paint(recB)
    expect(houseTiles(only, B)).toBe(0)
  })

  it('gives the same houses whichever cell arrives first, and covers the building without gaps or overlaps', () => {
    const ab = new TileWorld(A)
    ab.paint(recA)
    ab.paint(recB)
    const ba = new TileWorld(A)
    ba.paint(recB)
    ba.paint(recA)
    expect(structures(ab)).toEqual(structures(ba))
    const { houses } = structures(ab)
    expect(houses.length).toBeGreaterThan(1)
    // Every building tile of both cells has a house (the building has no landmark), and none is covered twice.
    const covered = new Set<number>()
    for (const h of houses) {
      const [x, y, w, hh] = h.split(',').map(Number) as [number, number, number, number]
      for (let yy = y; yy < y + hh; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const i = ab.grid.index(xx, yy)
          expect(covered.has(i)).toBe(false)
          covered.add(i)
        }
    }
    const total = buildingTiles(ab, A) + buildingTiles(ab, B)
    expect(total).toBeGreaterThan(150)
    expect(covered.size).toBeGreaterThan(total * 0.6)
    // Houses stand on both sides of the border.
    expect(houseTiles(ab, A)).toBeGreaterThan(0)
    expect(houseTiles(ab, B)).toBeGreaterThan(0)
  })

  it('drops the reaching houses with the cell that owns them and tells the neighbour tiles to repaint', () => {
    const tw = new TileWorld(A)
    tw.paint(recA)
    tw.paint(recB)
    const east = tw.ownedRect(B)!
    const seen: { x: number; w: number }[] = []
    tw.subscribe((r) => seen.push(r))
    expect(houseTiles(tw, B)).toBeGreaterThan(0)
    tw.clear(A)
    expect(houseTiles(tw, B)).toBe(0)
    expect(seen[0]!.x + seen[0]!.w).toBeGreaterThan(east.x + 5)
  })
})
