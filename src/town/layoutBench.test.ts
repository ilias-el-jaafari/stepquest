import { describe, expect, it } from 'vitest'
import { bboxAround } from '../geo/geo.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain, TileGrid } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { layoutTown } from './layout.ts'

/** Timing report for the town layout (printed for the review; no time assertions, CI machines vary). */
function cityGrid(tiles: number, blockTiles: number, street: number): TileGrid {
  const g = new TileGrid(bboxAround({ lat: 39.49, lon: -0.39 }, (tiles * 5) / 2), 5)
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++) {
      const inStreet = blockTiles > 0 && (x % (blockTiles + street) >= blockTiles || y % (blockTiles + street) >= blockTiles)
      g.terrain[g.index(x, y)] = inStreet ? Terrain.road : Terrain.building
    }
  return g
}

function time(label: string, grid: TileGrid): number {
  const t0 = performance.now()
  const town = layoutTown(grid)
  const ms = performance.now() - t0
  console.info(`[town bench] ${label}: ${grid.cols}x${grid.rows} tiles, ${town.houses.length} houses, ${ms.toFixed(0)} ms`)
  return ms
}

describe('town layout timing', () => {
  it('reports layout time for the demo, a city of blocks and one giant block', () => {
    time('benicalap demo', buildTileGrid(loadDemoOsm()))
    time('city 600x600, 40-tile blocks', cityGrid(600, 40, 6))
    // Generous budget (about 25 times the measured time) so slow CI machines pass but a quadratic step does not.
    expect(time('giant block 600x600', cityGrid(600, 0, 0))).toBeLessThan(5000)
  }, 120_000)
})
