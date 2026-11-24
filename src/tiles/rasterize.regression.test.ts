import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { layoutTown } from '../town/layout.ts'
import { Terrain, TileGrid } from './grid.ts'
import { clipSegment, cutRailsAtBridges, fillPolygon, fillRings, line4, rasterizeOsm, thickSegment, type Pt } from './rasterize.ts'

/** A 100 × 100 tile area (500 m) in València, built from tile coordinates so tests read in tiles. */
const BBOX = { south: 39.49, west: -0.4, north: 39.49 + 500 / 111_320, east: -0.4 + 500 / (111_320 * Math.cos(39.49 * (Math.PI / 180))) }

type Spec = Omit<Partial<OsmWay>, 'holes'> & { kind: OsmWay['kind']; pts: Pt[]; holes?: Pt[][] }

function build(specs: Spec[]): TileGrid {
  const grid = new TileGrid(BBOX)
  const lat: number[] = []
  const lon: number[] = []
  const add = (pts: Pt[]) =>
    pts.map((p) => {
      const ll = grid.tileToLatLon(p.x, p.y)
      lat.push(ll.lat)
      lon.push(ll.lon)
      return lat.length - 1
    })
  const ways: OsmWay[] = specs.map(({ pts, holes, ...rest }, i) => ({
    id: i + 1,
    walkable: false,
    area: false,
    tunnel: false,
    crossing: false,
    nodes: add(pts),
    ...(holes ? { holes: holes.map(add) } : {}),
    ...rest,
  }))
  const data: OsmData = { bbox: BBOX, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [], source: 'fixture', timestamp: '' }
  return rasterizeOsm(grid, data)
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
]
const count = (g: TileGrid, t: number) => g.terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0)

describe('grid size', () => {
  it('has the expected 100 × 100 tiles for the test box', () => {
    const g = new TileGrid(BBOX)
    expect(g.cols).toBeGreaterThanOrEqual(99)
    expect(g.cols).toBeLessThanOrEqual(101)
    expect(g.rows).toBeGreaterThanOrEqual(99)
  })
})

describe('multipolygon holes (66.3)', () => {
  it('leaves a courtyard empty inside a building', () => {
    const g = build([{ kind: 'building', area: true, pts: rect(10, 10, 30, 30), holes: [rect(16, 16, 22, 22)] }])
    expect(count(g, Terrain.building)).toBe(400 - 36)
    expect(g.terrainAt(18, 18)).toBe(Terrain.ground)
    expect(g.terrainAt(12, 12)).toBe(Terrain.building)
  })
  it('lets a pond hole in a park show the ground, and a water polygon fill it again', () => {
    const park = { kind: 'park' as const, area: true, pts: rect(10, 10, 50, 50), holes: [rect(20, 20, 30, 30)] }
    expect(build([park]).terrainAt(25, 25)).toBe(Terrain.ground)
    expect(build([park, { kind: 'water', area: true, pts: rect(20, 20, 30, 30) }]).terrainAt(25, 25)).toBe(Terrain.water)
  })
  it('keeps houses out of the courtyard of a building block', () => {
    const g = build([{ kind: 'building', area: true, pts: rect(10, 10, 40, 40), holes: [rect(20, 20, 30, 30)] }])
    const town = layoutTown(g)
    expect(town.houses.length).toBeGreaterThan(0)
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) expect(town.houseAt[g.index(x, y)]).toBe(-1)
  })
})

describe('features that leave the grid (66.3)', () => {
  it('fills a park cut by the area edge right up to the edge, in tile coordinates', () => {
    const g = build([{ kind: 'park', area: true, pts: rect(-60, 10, 30, 40) }])
    for (let y = 10; y < 40; y++) {
      expect(g.terrainAt(0, y)).toBe(Terrain.park)
      expect(g.terrainAt(29, y)).toBe(Terrain.park)
      expect(g.terrainAt(30, y)).toBe(Terrain.ground)
    }
  })
  it('finishes a polygon of continental size in milliseconds and visits only grid tiles', () => {
    const t0 = performance.now()
    let visits = 0
    const bounds = { cols: 100, rows: 100 }
    fillPolygon(rect(-2e6, -2e6, 2e6, 2e6), (x, y) => {
      visits++
      expect(x >= 0 && x < 100 && y >= 0 && y < 100).toBe(true)
    }, bounds)
    expect(visits).toBe(10_000)
    expect(performance.now() - t0).toBeLessThan(300)
  })
  it('clips a 100 km road and a long river to the grid without walking along their whole length', () => {
    const t0 = performance.now()
    const g = build([
      { kind: 'road', highway: 'residential', pts: [{ x: -2e7, y: 50 }, { x: 2e7, y: 50 }] },
      { kind: 'waterway', pts: [{ x: 70, y: -2e7 }, { x: 70, y: 2e7 }] },
    ])
    expect(performance.now() - t0).toBeLessThan(500)
    expect(g.terrainAt(10, 50)).toBe(Terrain.road)
    expect(g.terrainAt(70, 5)).toBe(Terrain.water)
  })
  it('ignores NaN and infinite coordinates instead of hanging', () => {
    const seen: number[] = []
    const visit = (x: number) => seen.push(x)
    const bad = [{ x: 0, y: 0 }, { x: Number.NaN, y: 5 }, { x: 10, y: 10 }]
    fillPolygon(bad, visit)
    fillPolygon([{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 5, y: 5 }], visit)
    thickSegment({ x: 0, y: 0 }, { x: Infinity, y: 1 }, 1, visit)
    line4({ x: Number.NaN, y: 0 }, { x: 3, y: 3 }, visit)
    expect(seen).toEqual([])
  })
  it('clips a segment to a rectangle, leaving inside segments untouched', () => {
    const a = { x: 1, y: 1 }
    const b = { x: 5, y: 2 }
    expect(clipSegment(a, b, 0, 0, 10, 10)).toEqual([a, b])
    expect(clipSegment({ x: -5, y: 5 }, { x: 15, y: 5 }, 0, 0, 10, 10)).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }])
    expect(clipSegment({ x: -5, y: -5 }, { x: -1, y: 20 }, 0, 0, 10, 10)).toBeNull()
  })
})

describe('self-intersecting and degenerate polygons (66.3)', () => {
  const fill = (pts: Pt[]) => {
    const cells = new Set<string>()
    fillPolygon(pts, (x, y) => cells.add(`${x},${y}`))
    return cells
  }
  it('fills both triangles of a bow-tie and no sliver between them (even-odd)', () => {
    const cells = fill([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])
    expect(cells.has('1,5')).toBe(true)
    expect(cells.has('8,5')).toBe(true)
    expect(cells.has('5,1')).toBe(false)
    expect(cells.has('5,8')).toBe(false)
  })
  it('fills nothing for zero-area outlines and the same ring drawn twice', () => {
    expect(fill([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]).size).toBe(0)
    expect(fill([{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 }]).size).toBe(0)
    const ring = rect(0, 0, 8, 8)
    const cells = new Set<string>()
    fillRings([ring, ring], (x, y) => cells.add(`${x},${y}`))
    expect(cells.size).toBe(0)
  })
  it('handles a zero-length road segment (duplicate nodes) as a round dot', () => {
    const cells = new Set<string>()
    thickSegment({ x: 5.5, y: 5.5 }, { x: 5.5, y: 5.5 }, 1.2, (x, y) => cells.add(`${x},${y}`))
    expect(cells.has('5,5')).toBe(true)
    expect(cells.size).toBeGreaterThanOrEqual(5)
  })
})

describe('bridges and tunnels (66.3)', () => {
  const river: Spec = { kind: 'waterway', pts: [{ x: 50.5, y: 0 }, { x: 50.5, y: 99 }] }
  it('paints a footbridge over water as path, with water on both sides', () => {
    const g = build([river, { kind: 'path', highway: 'footway', bridge: true, walkable: true, pts: [{ x: 30.5, y: 40.5 }, { x: 70.5, y: 40.5 }] }])
    expect(g.terrainAt(50, 40)).toBe(Terrain.path)
    expect(g.terrainAt(50, 38)).toBe(Terrain.water)
    expect(g.terrainAt(50, 42)).toBe(Terrain.water)
    expect(g.bridgeAt(50, 40)).toBe(true)
    expect(g.bridgeAt(50, 38)).toBe(false)
  })
  it('paints a road bridge over water as road', () => {
    const g = build([river, { kind: 'road', highway: 'primary', bridge: true, walkable: true, pts: [{ x: 30.5, y: 60.5 }, { x: 70.5, y: 60.5 }] }])
    expect(g.terrainAt(50, 60)).toBe(Terrain.road)
  })
  it('draws nothing for a tunnel: not over the surface, not over water, not over buildings', () => {
    const g = build([
      river,
      { kind: 'building', area: true, pts: rect(20, 20, 30, 30) },
      { kind: 'road', highway: 'primary', tunnel: true, walkable: true, pts: [{ x: 5.5, y: 25.5 }, { x: 95.5, y: 25.5 }] },
    ])
    expect(g.terrainAt(50, 25)).toBe(Terrain.water)
    expect(g.terrainAt(25, 25)).toBe(Terrain.building)
    expect(g.terrainAt(10, 25)).toBe(Terrain.ground)
  })
  it('does not draw rails on top of a bridge deck, and leaves other rails exactly as they were', () => {
    const rails: Spec[] = [
      { kind: 'rail', pts: [{ x: 10, y: 60.5 }, { x: 50, y: 60.5 }, { x: 90, y: 60.5 }] },
      { kind: 'rail', pts: [{ x: 10, y: 80.5 }, { x: 90, y: 80.5 }] },
    ]
    const deck: Spec = { kind: 'road', highway: 'secondary', bridge: true, walkable: true, pts: [{ x: 50.5, y: 40 }, { x: 50.5, y: 80 }] }
    const without = build(rails)
    const g = build([...rails, deck])
    // The rail at y = 80.5 also meets the deck's end tile; the untouched one is the byte-identical input.
    expect(without.rails).toHaveLength(2)
    for (const piece of g.rails) {
      for (let i = 1; i < piece.length; i++) {
        const mid = { x: (piece[i]!.x + piece[i - 1]!.x) / 2, y: (piece[i]!.y + piece[i - 1]!.y) / 2 }
        expect(g.bridgeAt(Math.floor(mid.x), Math.floor(mid.y))).toBe(false)
      }
    }
    expect(g.rails.length).toBeGreaterThanOrEqual(3) // y = 60 rail cut in two, y = 80 rail cut in two
    const far = cutRailsAtBridges(without.rails, () => false)
    expect(far).toEqual(without.rails)
  })
})

describe('the bundled demo is unchanged (66.1)', () => {
  it('rasterizes to the same layers, terrain, styles, barriers and rails as before the rework', () => {
    const g = rasterizeOsm(new TileGrid(loadDemoOsm().bbox), loadDemoOsm())
    // FNV-1a over every byte; the same data hashed to this value on the code before the rework.
    let h = 0x811c9dc5
    const feed = (bytes: ArrayLike<number>) => {
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0
    }
    for (const a of [g.layers, g.terrain, g.style, g.barrier]) feed(a)
    feed(new TextEncoder().encode(JSON.stringify(g.rails)))
    expect(`${h.toString(16)} ${g.cols}x${g.rows}`).toBe('3a0ae8df 635x645')
  })
})
