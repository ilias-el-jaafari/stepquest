import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Layer, Terrain, TileGrid } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { townFor } from '../town/layout.ts'
import { LAMP_SPACING, streetLamps } from './lamps.ts'
import { litHouseWindows } from './lights.ts'

const grid = buildTileGrid(loadDemoOsm())

describe('lit windows', () => {
  const town = townFor(grid)
  it('are found on the painted glass, stable, and not every window', () => {
    let lit = 0
    let total = 0
    for (const h of town.houses.slice(0, 300)) {
      const a = litHouseWindows(h)
      expect(litHouseWindows(h)).toBe(a)
      for (const r of a) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(h.w * 16)
      }
      lit += a.length
      total += 1
    }
    expect(lit).toBeGreaterThan(total) // several windows per building on average
    const withAll = town.houses.filter((h) => h.kind === 'apartments' && h.w >= 4)
    const someDark = withAll.some((h) => litHouseWindows(h).length < h.w * Math.max(2, h.h - 2))
    expect(someDark).toBe(true)
  })
})

describe('street lamps', () => {
  it('rasterization marks lit=yes roads', () => {
    let lit = 0
    for (const b of grid.layers) if (b & Layer.lit) lit++
    expect(lit).toBeGreaterThan(100)
    for (const b of grid.layers) if (b & Layer.lit) expect(b & Layer.road).toBeTruthy()
  })
  it('stand on kerbs of the fixture, deterministically', () => {
    const lamps = streetLamps(grid)
    expect(lamps.length).toBeGreaterThan(50)
    expect(streetLamps(grid)).toEqual(lamps)
    for (const l of lamps) expect([Terrain.road, Terrain.crossing]).toContain(grid.terrain[l.y * grid.cols + l.x])
  })
  it('are spaced along a lit street and skip unlit narrow ones', () => {
    const g = new TileGrid({ south: 39.49, north: 39.4935, west: -0.4, east: -0.39 })
    for (let x = 0; x < g.cols; x++) {
      for (let y = 10; y < 13; y++) g.add(x, y, Layer.road | Layer.lit)
      g.add(x, 30, Layer.road)
    }
    g.resolveTerrain()
    const lamps = streetLamps(g)
    expect(lamps.every((l) => l.y >= 10 && l.y < 13)).toBe(true)
    const north = lamps.filter((l) => l.y === 10).map((l) => l.x)
    expect(north.length).toBeGreaterThan(3)
    for (let i = 1; i < north.length; i++) expect(north[i]! - north[i - 1]!).toBe(LAMP_SPACING * 2)
    // The other side is offset so lamps alternate.
    expect(lamps.some((l) => l.y === 12)).toBe(true)
  })
})
