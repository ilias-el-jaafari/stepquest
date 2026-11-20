import { describe, expect, it } from 'vitest'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { gridMask4 } from './autotile.ts'
import { Layer, resolveLayers, Terrain, TileGrid } from './grid.ts'
import { buildTileGrid, fillPolygon, line4, thickSegment } from './rasterize.ts'

function collect(fn: (visit: (x: number, y: number) => void) => void) {
  const cells = new Set<string>()
  fn((x, y) => cells.add(`${x},${y}`))
  return cells
}

function is4Connected(cells: Set<string>): boolean {
  const list = [...cells]
  if (list.length === 0) return true
  const seen = new Set([list[0]!])
  const queue = [list[0]!]
  while (queue.length) {
    const [x, y] = queue.pop()!.split(',').map(Number) as [number, number]
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${x + dx},${y + dy}`
      if (cells.has(key) && !seen.has(key)) {
        seen.add(key)
        queue.push(key)
      }
    }
  }
  return seen.size === cells.size
}

describe('line4', () => {
  it('draws horizontal and vertical lines tile by tile', () => {
    expect(collect((v) => line4({ x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, v)).size).toBe(5)
    expect(collect((v) => line4({ x: 2.5, y: 5.5 }, { x: 2.5, y: 1.5 }, v)).size).toBe(5)
  })
  it('keeps diagonal lines 4-connected (no corner-only steps)', () => {
    for (const [ax, ay, bx, by] of [[0.5, 0.5, 9.5, 9.5], [0.2, 7.9, 8.7, 0.1], [3.3, 1.1, 0.4, 12.6]] as const) {
      const cells = collect((v) => line4({ x: ax, y: ay }, { x: bx, y: by }, v))
      expect(is4Connected(cells)).toBe(true)
      expect(cells.has(`${Math.floor(ax)},${Math.floor(ay)}`)).toBe(true)
      expect(cells.has(`${Math.floor(bx)},${Math.floor(by)}`)).toBe(true)
    }
  })
})

describe('thickSegment', () => {
  it('produces a band about twice the half-width', () => {
    const cells = collect((v) => thickSegment({ x: 0, y: 5 }, { x: 20, y: 5 }, 1, v))
    const column = [...cells].filter((c) => c.startsWith('10,')).length
    expect(column).toBe(2)
    expect(is4Connected(cells)).toBe(true)
  })
  it('stays connected on a diagonal', () => {
    const cells = collect((v) => thickSegment({ x: 0, y: 0 }, { x: 15, y: 11 }, 0.9, v))
    expect(is4Connected(cells)).toBe(true)
  })
})

describe('fillPolygon', () => {
  it('fills a 4×3 rectangle exactly', () => {
    const cells = collect((v) => fillPolygon([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }], v))
    expect(cells.size).toBe(12)
    expect(cells.has('1,1')).toBe(true)
    expect(cells.has('4,3')).toBe(true)
    expect(cells.has('5,1')).toBe(false)
  })
  it('handles a concave L shape', () => {
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    const cells = collect((v) => fillPolygon(L, v))
    expect(cells.size).toBe(12)
    expect(cells.has('3,0')).toBe(false)
    expect(cells.has('3,3')).toBe(true)
  })
  it('ignores degenerate polygons', () => {
    expect(collect((v) => fillPolygon([{ x: 0, y: 0 }, { x: 3, y: 3 }], v)).size).toBe(0)
  })
})

describe('terrain resolution', () => {
  it('prefers crossings, then roads, paths, buildings, water and parks', () => {
    expect(resolveLayers(Layer.road | Layer.path | Layer.crossing)).toBe(Terrain.crossing)
    // A sidewalk overlapping the drawn carriageway stays road.
    expect(resolveLayers(Layer.road | Layer.path)).toBe(Terrain.road)
    expect(resolveLayers(Layer.road | Layer.water)).toBe(Terrain.road) // bridge
    expect(resolveLayers(Layer.building | Layer.park)).toBe(Terrain.building)
    expect(resolveLayers(Layer.water | Layer.park)).toBe(Terrain.water)
    expect(resolveLayers(Layer.park)).toBe(Terrain.park)
    expect(resolveLayers(0)).toBe(Terrain.ground)
  })
  it('sizes the grid from the bbox and metres per tile', () => {
    const g = new TileGrid(DEMO_AREA.bbox, 5)
    // The demo box is about 3.18 km wide and 3.23 km tall.
    expect(g.cols).toBeGreaterThan(620)
    expect(g.cols).toBeLessThan(650)
    expect(g.rows).toBeGreaterThan(630)
    expect(g.rows).toBeLessThan(660)
  })
})

describe('rasterizing the Benicalap fixture', () => {
  const grid = buildTileGrid(loadDemoOsm())
  const counts = new Map<number, number>()
  for (const t of grid.terrain) counts.set(t, (counts.get(t) ?? 0) + 1)
  const total = grid.terrain.length
  const share = (t: number) => (counts.get(t) ?? 0) / total

  it('contains every terrain type', () => {
    for (const t of Object.values(Terrain)) expect(counts.get(t) ?? 0, `terrain ${t}`).toBeGreaterThan(0)
  })
  it('has a plausible urban mix', () => {
    expect(share(Terrain.building)).toBeGreaterThan(0.12)
    expect(share(Terrain.road) + share(Terrain.crossing)).toBeGreaterThan(0.08)
    expect(share(Terrain.path)).toBeGreaterThan(0.03)
    expect(share(Terrain.park)).toBeGreaterThan(0.02)
  })
  it('puts a street under the demo start point', () => {
    const p = grid.toTileXY(DEMO_AREA.defaultStart)
    let near = false
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const t = grid.terrainAt(Math.floor(p.x) + dx, Math.floor(p.y) + dy)
        if (t === Terrain.road || t === Terrain.path || t === Terrain.crossing) near = true
      }
    expect(near).toBe(true)
  })
  it('auto-tiles most footway tiles as connected pieces, not isolated dots', () => {
    let paths = 0
    let isolated = 0
    for (let y = 0; y < grid.rows; y += 2)
      for (let x = 0; x < grid.cols; x += 2)
        if (grid.terrainAt(x, y) === Terrain.path) {
          paths++
          if (gridMask4(grid, x, y) === 0) isolated++
        }
    expect(paths).toBeGreaterThan(500)
    expect(isolated / paths).toBeLessThan(0.02)
  })
})
