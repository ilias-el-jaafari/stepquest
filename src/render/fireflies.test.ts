import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { CHUNK } from './chunkLayer.ts'
import { firefliesInChunk, fireflyLevel, MAX_FIREFLIES_PER_CHUNK } from './fireflies.ts'

const grid = buildTileGrid(loadDemoOsm())

function all() {
  const out: { cx: number; cy: number; list: ReturnType<typeof firefliesInChunk> }[] = []
  for (let cy = 0; cy * CHUNK < grid.rows; cy++) for (let cx = 0; cx * CHUNK < grid.cols; cx++) out.push({ cx, cy, list: firefliesInChunk(grid, cx, cy, CHUNK) })
  return out
}

describe('fireflies', () => {
  it('sit on park tiles, a few per chunk, the same every time', () => {
    const a = all()
    expect(a.some((c) => c.list.length > 0)).toBe(true)
    for (const { cx, cy, list } of a) {
      expect(list.length).toBeLessThanOrEqual(MAX_FIREFLIES_PER_CHUNK)
      expect(firefliesInChunk(grid, cx, cy, CHUNK)).toBe(list)
      for (const f of list) {
        expect(grid.terrain[Math.floor(f.y) * grid.cols + Math.floor(f.x)]).toBe(Terrain.park)
        expect(Math.floor(f.x / CHUNK)).toBe(cx)
        expect(Math.floor(f.y / CHUNK)).toBe(cy)
      }
    }
  })
  it('blink in 0 to 1, and stay steady and dim with reduced motion', () => {
    const f = all().flatMap((c) => c.list)[0]!
    const levels = new Set<number>()
    for (let t = 0; t < 5000; t += 100) {
      const v = fireflyLevel(f, t, false)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      levels.add(v)
      expect(fireflyLevel(f, t, true)).toBe(0.5)
    }
    expect(levels.size).toBeGreaterThan(5)
  })
})
