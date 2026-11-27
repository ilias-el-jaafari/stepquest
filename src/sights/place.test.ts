import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { footprint, placeSights, PLACE_RADIUS } from './place.ts'
import { SIGHT_KINDS, type SightMark } from './types.ts'

const grid = buildTileGrid(loadDemoOsm())
const markAt = (tx: number, ty: number, kind: SightMark['kind'] = 'school', id = `${tx},${ty}`): SightMark => {
  const p = grid.tileToLatLon(tx + 0.5, ty + 0.5)
  return { id, kind, lat: p.lat, lon: p.lon, alongM: 0, lateralM: 0 }
}
/** Tiles of the grid that are open ground (no street, path, crossing or water). */
const openTiles: [number, number][] = []
for (let y = 10; y < grid.rows - 10; y += 7) for (let x = 10; x < grid.cols - 10; x += 7) if (![Terrain.road, Terrain.path, Terrain.crossing, Terrain.water].includes(grid.terrain[y * grid.cols + x] as 4)) openTiles.push([x, y])

describe('placeSights', () => {
  it('stands each sight on loaded ground that is no street or water, within reach of its point', () => {
    const marks = openTiles.slice(0, 20).map(([x, y], i) => markAt(x, y, SIGHT_KINDS[i % SIGHT_KINDS.length]!, `m${i}`))
    const placed = placeSights(marks, grid, new Set())
    expect(placed.length).toBeGreaterThan(5)
    for (const p of placed) {
      const t = grid.toTileXY(p.mark)
      expect(Math.hypot(p.x + p.w / 2 - t.x, p.y + p.h - t.y)).toBeLessThanOrEqual(PLACE_RADIUS + 3)
      for (let j = p.y; j < p.y + p.h; j++) {
        for (let i = p.x; i < p.x + p.w; i++) {
          expect([Terrain.road, Terrain.path, Terrain.crossing, Terrain.water]).not.toContain(grid.terrain[j * grid.cols + i])
        }
      }
    }
  })

  it('never covers the keep-out tiles and never overlaps another sight', () => {
    const [x, y] = openTiles[3]!
    const keep = new Set<number>()
    for (let j = y - 2; j <= y + 2; j++) for (let i = x - 2; i <= x + 2; i++) keep.add(j * grid.cols + i)
    const placed = placeSights([markAt(x, y, 'church', 'a'), markAt(x, y, 'mosque', 'b'), markAt(x, y, 'temple', 'c')], grid, keep)
    const seen = new Set<number>()
    for (const p of placed) {
      for (let j = p.y; j < p.y + p.h; j++) {
        for (let i = p.x; i < p.x + p.w; i++) {
          const k = j * grid.cols + i
          expect(keep.has(k)).toBe(false)
          expect(seen.has(k)).toBe(false)
          seen.add(k)
        }
      }
    }
    expect(placed.length).toBeGreaterThan(0)
  })

  it('leaves a sight out when nothing is free, or the map is not loaded there', () => {
    const [x, y] = openTiles[0]!
    const all = new Set<number>()
    for (let k = 0; k < grid.cols * grid.rows; k++) all.add(k)
    expect(placeSights([markAt(x, y)], grid, all)).toEqual([])
    expect(placeSights([markAt(-500, -500)], grid, new Set())).toEqual([])
  })

  it('sizes a footprint from the sprite', () => {
    for (const k of SIGHT_KINDS) {
      const f = footprint(k)
      expect(f.w).toBeGreaterThanOrEqual(1)
      expect(f.w).toBeLessThanOrEqual(5)
      expect(f.h).toBeLessThanOrEqual(5)
    }
  })
})
