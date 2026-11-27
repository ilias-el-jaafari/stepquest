import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Layer } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { forgetLamps, lampsInChunk, streetLamps } from './lamps.ts'

const CHUNK = 32

describe('lamps are found chunk by chunk', () => {
  it('gives each chunk exactly the lamps the whole-grid scan puts in it, in the same order', () => {
    const grid = buildTileGrid(loadDemoOsm())
    const all = streetLamps(grid)
    const rebuilt: { x: number; y: number }[] = []
    const cols = Math.ceil(grid.cols / CHUNK)
    const rows = Math.ceil(grid.rows / CHUNK)
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) rebuilt.push(...lampsInChunk(grid, cx, cy, CHUNK))
    const key = (l: { x: number; y: number }) => `${l.x},${l.y}`
    expect(rebuilt.map(key).sort()).toEqual(all.map(key).sort())
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const own = all.filter((l) => Math.floor(l.x / CHUNK) === cx && Math.floor(l.y / CHUNK) === cy)
        expect(lampsInChunk(grid, cx, cy, CHUNK)).toEqual(own)
      }
    }
  })

  it('scans only the chunks a changed rectangle reaches (a cell arriving far away costs nothing)', () => {
    const grid = buildTileGrid(loadDemoOsm())
    const far = lampsInChunk(grid, 0, 0, CHUNK)
    const near = lampsInChunk(grid, 5, 5, CHUNK)
    // The rectangle sits in chunk (10, 10): chunks (0, 0) and (5, 5) keep their cached lists.
    forgetLamps(grid, { x: 10 * CHUNK + 4, y: 10 * CHUNK + 4, w: 8, h: 8 })
    expect(lampsInChunk(grid, 0, 0, CHUNK)).toBe(far)
    expect(lampsInChunk(grid, 5, 5, CHUNK)).toBe(near)
  })

  it('scans a chunk again when the rectangle touches it, and when it only reaches it from 3 tiles away', () => {
    const grid = buildTileGrid(loadDemoOsm())
    const list = lampsInChunk(grid, 3, 3, CHUNK)
    // Just outside the chunk's tiles, inside a lamp's reach along a street.
    forgetLamps(grid, { x: 3 * CHUNK - 2, y: 3 * CHUNK, w: 1, h: 4 })
    const again = lampsInChunk(grid, 3, 3, CHUNK)
    expect(again).not.toBe(list)
    expect(again).toEqual(list)
  })

  it('follows a changed road: a new street in the rectangle brings its lamps', () => {
    const grid = buildTileGrid(loadDemoOsm())
    const before = lampsInChunk(grid, 6, 6, CHUNK).length
    const rect = { x: 6 * CHUNK + 2, y: 6 * CHUNK + 10, w: 20, h: 4 }
    for (let x = rect.x; x < rect.x + rect.w; x++) for (let y = rect.y; y < rect.y + rect.h; y++) grid.add(x, y, Layer.road | Layer.lit)
    grid.resolveTerrain()
    forgetLamps(grid, rect)
    expect(lampsInChunk(grid, 6, 6, CHUNK).length).toBeGreaterThan(before)
  })

  it('forgets everything without a rectangle', () => {
    const grid = buildTileGrid(loadDemoOsm())
    const list = lampsInChunk(grid, 2, 2, CHUNK)
    forgetLamps(grid)
    expect(lampsInChunk(grid, 2, 2, CHUNK)).not.toBe(list)
  })
})
