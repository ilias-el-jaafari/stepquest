import { describe, expect, it } from 'vitest'
import { Dir8 } from '../tiles/autotile.ts'
import { Layer, Terrain, TileGrid } from '../tiles/grid.ts'
import type { House } from '../town/layout.ts'
import { WATER_FRAMES, waterFrame } from './MapRenderer.ts'
import { P } from './palette.ts'
import { paintHouse } from './structures.ts'
import { paintTile, tileKey, type TileSpec } from './tileset.ts'
import { laneCode, tileSpecAt } from './tileSpecs.ts'

/** Records the colour of every pixel painted into a size×size area. */
class PixelCtx {
  fillStyle = ''
  readonly size: number
  readonly px: string[]
  constructor(size = 16) {
    this.size = size
    this.px = new Array(size * size).fill('')
  }
  fillRect(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < this.size && yy < this.size) this.px[yy * this.size + xx] = this.fillStyle
  }
  at(x: number, y: number) {
    return this.px[y * this.size + x]
  }
  count(color: string) {
    return this.px.filter((c) => c === color).length
  }
}

function paint(spec: Partial<TileSpec> & { terrain: TileSpec['terrain'] }) {
  const ctx = new PixelCtx()
  paintTile(ctx as unknown as CanvasRenderingContext2D, 0, 0, { m4: 0, m8: 255, variant: 7, vertical: false, ...spec })
  return ctx
}

describe('road tiles', () => {
  it('keep a subtle asphalt grain that is the same every time', () => {
    const a = paint({ terrain: Terrain.road, variant: 3 })
    const b = paint({ terrain: Terrain.road, variant: 3 })
    expect(a.px).toEqual(b.px)
    const grain = a.count(P.asphaltB) + a.count(P.asphaltDot)
    expect(grain).toBeGreaterThan(8)
    expect(grain).toBeLessThan(64) // subtle: well under a quarter of the tile
  })
  it('draw a dashed centre line only when a lane code says so', () => {
    expect(paint({ terrain: Terrain.road, lane: 0 }).count(P.laneMark)).toBe(0)
    const dash = paint({ terrain: Terrain.road, lane: 1 })
    expect(dash.at(0, 7)).toBe(P.laneMark)
    expect(dash.at(7, 8)).toBe(P.laneMark)
    expect(dash.at(8, 7)).not.toBe(P.laneMark)
    const second = paint({ terrain: Terrain.road, lane: 1 | 8 })
    expect(second.at(8, 7)).toBe(P.laneMark)
    expect(second.at(7, 7)).not.toBe(P.laneMark)
    const vertical = paint({ terrain: Terrain.road, lane: 2 })
    expect(vertical.at(7, 0)).toBe(P.laneMark)
    expect(vertical.at(8, 7)).toBe(P.laneMark)
    const edge = paint({ terrain: Terrain.road, lane: 1 | 4 })
    expect(edge.at(2, 13)).toBe(P.laneMark)
  })
  it('light the kerb faces that look to the top-left (south and east bands) and shade the others', () => {
    const open = Dir8.N | Dir8.E | Dir8.S | Dir8.W
    const noN = paint({ terrain: Terrain.road, m8: 255 & ~Dir8.N & ~Dir8.NE & ~Dir8.NW })
    const noS = paint({ terrain: Terrain.road, m8: 255 & ~Dir8.S & ~Dir8.SE & ~Dir8.SW })
    expect(noN.at(8, 2)).toBe(P.curbShadow)
    expect(noS.at(8, 13)).toBe(P.kerbLight)
    expect(open).toBeGreaterThan(0)
    // The kerb band itself is pale paving with joints.
    expect(noN.at(0, 1)).toBe(P.curb)
    expect(noN.px.slice(0, 16).includes(P.stoneDark)).toBe(true)
  })
  it('shade the lower or right row of zebra bars', () => {
    const horizontal = paint({ terrain: Terrain.crossing, vertical: false })
    expect(horizontal.at(5, 1)).toBe(P.white)
    expect(horizontal.at(5, 3)).toBe(P.fenceShade)
    const vertical = paint({ terrain: Terrain.crossing, vertical: true })
    expect(vertical.at(1, 5)).toBe(P.white)
    expect(vertical.at(3, 5)).toBe(P.fenceShade)
  })
})

describe('footpaths', () => {
  it('are packed earth in parks and flagstones elsewhere', () => {
    const earth = paint({ terrain: Terrain.path, m4: 10, surface: 0 })
    const paved = paint({ terrain: Terrain.path, m4: 10, surface: 1 })
    expect(earth.px.includes(P.pathA)).toBe(true)
    expect(earth.px.includes(P.stone)).toBe(false)
    expect(paved.px.includes(P.stone)).toBe(true)
    expect(paved.px.includes(P.pathA)).toBe(false)
    // Joints and a lit corner on the slabs.
    expect(paved.px.includes(P.stoneDark)).toBe(true)
    expect(paved.px.includes(P.stoneLight)).toBe(true)
  })
})

describe('plaza paving', () => {
  it('has lit slab corners', () => {
    expect(paint({ terrain: Terrain.plaza, m8: 255 }).at(0, 0)).toBe(P.stoneLight)
  })
})

describe('park grass', () => {
  const grass = (variant: number, extra: Partial<TileSpec> = {}) => paint({ terrain: Terrain.park, style: 0, variant, ...extra })
  it('varies by variant: tufts, stones, flowers, trees', () => {
    expect(grass(2).count(P.grassTuft)).toBeGreaterThan(0)
    expect(grass(2).count(P.stoneDark)).toBe(0)
    expect(grass(4).count(P.stone)).toBeGreaterThan(0)
    expect(grass(5).count(P.flowerY)).toBeGreaterThan(0)
    expect(grass(0).count(P.trunk)).toBeGreaterThan(0)
    // Edge tiles that would hold a tree get tufts instead.
    expect(grass(0, { m8: 0 }).count(P.trunk)).toBe(0)
    expect(grass(0, { m8: 0 }).count(P.grassTuft)).toBeGreaterThan(0)
  })
  it('is stable: the same spec always paints the same pixels', () => {
    for (let v = 0; v < 8; v++) expect(grass(v).px).toEqual(grass(v).px)
  })
  it('draws a bush beside a tree only when asked', () => {
    const bush = grass(2, { deco: 1 })
    expect(bush.count(P.treeLight)).toBeGreaterThan(0)
    expect(grass(2).count(P.treeLight)).toBe(0)
  })
})

describe('water', () => {
  const water = (frame: number, extra: Partial<TileSpec> = {}) => paint({ terrain: Terrain.water, variant: 2, frame, ...extra })
  it('has three different ripple frames that loop', () => {
    const [a, b, c] = [water(0), water(1), water(2)]
    expect(a.px).not.toEqual(b.px)
    expect(b.px).not.toEqual(c.px)
    expect(a.px).not.toEqual(c.px)
    expect(water(0).px).toEqual(paint({ terrain: Terrain.water, variant: 2 }).px)
    for (const f of [a, b, c]) expect(f.px.every((p) => p !== '')).toBe(true)
  })
  it('keeps the shore edge on every frame', () => {
    for (let f = 0; f < WATER_FRAMES; f++) expect(water(f, { m8: 255 & ~Dir8.N & ~Dir8.NE & ~Dir8.NW }).at(8, 0)).toBe(P.sand)
  })
  it('stays on frame 0 for reduced motion and cycles otherwise', () => {
    expect(waterFrame(123456, true)).toBe(0)
    expect(new Set([0, 450, 900, 1350].map((t) => waterFrame(t, false)))).toEqual(new Set([0, 1, 2]))
  })
  it('gets a tile key per frame', () => {
    const base: TileSpec = { terrain: Terrain.water, m4: 0, m8: 255, variant: 1, vertical: false }
    expect(new Set([0, 1, 2].map((frame) => tileKey({ ...base, frame }))).size).toBe(3)
    expect(tileKey({ ...base, lane: 1 })).not.toBe(tileKey(base))
    expect(tileKey({ ...base, surface: 1 })).not.toBe(tileKey(base))
    expect(tileKey({ ...base, deco: 1 })).not.toBe(tileKey(base))
  })
})

describe('tile specs for the new art', () => {
  const grid = new TileGrid({ south: 39.49, west: -0.4, north: 39.4915, east: -0.3985 }, 5)
  // A 3-wide east–west street (rows 10–12) and a 4-wide one (rows 20–23).
  for (let x = 0; x < grid.cols; x++) {
    for (const y of [10, 11, 12, 20, 21, 22, 23]) grid.add(x, y, Layer.road)
  }
  // A park with a footpath through it, and a footway on plain ground.
  for (let x = 2; x < 12; x++) for (let y = 2; y < 8; y++) grid.add(x, y, Layer.park)
  for (let x = 3; x < 8; x++) grid.add(x, 4, Layer.path)
  for (let x = 3; x < 8; x++) grid.add(x, 15, Layer.path)
  grid.resolveTerrain()

  it('puts the dashed line down the middle of wide streets, alternating every tile', () => {
    expect(laneCode(grid, 10, 11) & 3).toBe(1)
    expect(laneCode(grid, 10, 10)).toBe(0)
    expect(laneCode(grid, 10, 12)).toBe(0)
    expect(laneCode(grid, 10, 11) & 8).not.toBe(laneCode(grid, 11, 11) & 8)
    expect(tileSpecAt(grid, 10, 11).lane).toBe(laneCode(grid, 10, 11))
  })
  it('puts it on one edge row of an even-width street', () => {
    const lanes = [20, 21, 22, 23].map((y) => laneCode(grid, 10, y))
    expect(lanes.filter((l) => l !== 0)).toHaveLength(1)
    expect(lanes.find((l) => l !== 0)! & 4).toBe(4)
  })
  it('leaves narrow streets without a line', () => {
    const narrow = new TileGrid({ south: 39.49, west: -0.4, north: 39.4915, east: -0.3985 }, 5)
    for (let x = 0; x < narrow.cols; x++) for (const y of [5, 6]) narrow.add(x, y, Layer.road)
    narrow.resolveTerrain()
    for (let x = 0; x < narrow.cols; x++) for (const y of [5, 6]) expect(laneCode(narrow, x, y)).toBe(0)
  })
  it('picks packed earth for park paths and flagstones for other footways', () => {
    expect(tileSpecAt(grid, 5, 4).surface).toBe(0)
    expect(tileSpecAt(grid, 5, 15).surface).toBe(1)
  })
  it('gives only road tiles a lane, only park tiles a bush, and never changes with panning', () => {
    expect(tileSpecAt(grid, 5, 4).lane).toBe(0)
    expect(tileSpecAt(grid, 5, 5).deco === 0 || tileSpecAt(grid, 5, 5).deco === 1).toBe(true)
    expect(tileSpecAt(grid, 5, 15).deco).toBe(0)
    expect(tileSpecAt(grid, 6, 6)).toEqual(tileSpecAt(grid, 6, 6))
  })
})

describe('houses', () => {
  const house = (seed: number, kind: House['kind'] = 'house'): House => ({ x: 0, y: 0, w: 3, h: 4, kind, roof: 0, wall: 0, door: 1, seed, frontYard: false })
  const draw = (h: House) => {
    const ctx = new PixelCtx(64)
    paintHouse(ctx as unknown as CanvasRenderingContext2D, 0, 0, h)
    return ctx
  }
  it('use three roof styles chosen by the house seed', () => {
    const [shingles, seams, tiles] = [0, 1, 2].map((style) => draw(house(1 + 16 * style + 1)))
    expect(shingles!.px).not.toEqual(seams!.px)
    expect(seams!.px).not.toEqual(tiles!.px)
    expect(shingles!.px).not.toEqual(tiles!.px)
  })
  it('are deterministic per house', () => {
    expect(draw(house(77)).px).toEqual(draw(house(77)).px)
  })
  it('put an awning over some apartment shop fronts', () => {
    const [a] = P.awnings[0]!
    const shop = draw(house(0, 'apartments'))
    const plain = draw(house(32, 'apartments'))
    expect(shop.count(a)).toBeGreaterThan(0)
    expect((32 >>> 5) % 3).not.toBe(0)
    expect(plain.count(a)).toBe(0)
  })
})
