import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { cellBBox, cellKey, cellOf } from './cells.ts'
import { sliceToCells } from './slice.ts'
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
        expect(alone.town.houseAt(i)?.seed).toBe(forward.town.houseAt(i)?.seed)
      }
    }
    // Nothing outside the cell is covered.
    expect(alone.grid.coveredAt(rect.x - 1, rect.y)).toBe(false)
    expect(alone.grid.coveredAt(rect.x, rect.y)).toBe(true)
  })

  it('keeps every house and landmark on the tiles of its own cell, and none overlap', () => {
    const taken = new Map<number, string>()
    const { houses, landmarks } = structures(forward)
    expect(houses.length).toBeGreaterThan(1000)
    expect(landmarks.length).toBeGreaterThan(5)
    for (const s of [...houses, ...landmarks]) {
      const [x, y, w, h] = s.replace(/^[a-zA-Z]+:/, '').split(',').map(Number) as [number, number, number, number]
      const cell = forward.grid.tileToLatLon(x + 0.5, y + 0.5)
      const rect = forward.ownedRect(cellOf(cell))!
      expect(x + w).toBeLessThanOrEqual(rect.x + rect.w)
      expect(y + h).toBeLessThanOrEqual(rect.y + rect.h)
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const i = forward.grid.index(xx, yy)
          expect(taken.get(i)).toBeUndefined()
          taken.set(i, s)
        }
    }
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
    expect(seen).toEqual([{ x: own.x - 1, y: own.y - 1, w: own.w + 2, h: own.h + 2 }])
    expect(tw.grid.coveredAt(own.x + 3, own.y + 3)).toBe(false)
    expect(tw.grid.terrainAt(own.x + 3, own.y + 3)).toBe(Terrain.ground)
    expect(tw.town.houseAt(tw.grid.index(own.x + 3, own.y + 3))).toBeUndefined()
    expect(cellKey(centre)).toBe(`${centre.i},${centre.j}`)
  })

  it('clips track polylines to a rectangle', () => {
    expect(clipRails([[{ x: -5, y: 5 }, { x: 5, y: 5 }, { x: 15, y: 5 }]], { x: 0, y: 0, w: 10, h: 10 })).toEqual([[{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }]])
    expect(clipRails([[{ x: -5, y: 5 }, { x: -1, y: 5 }]], { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
})
