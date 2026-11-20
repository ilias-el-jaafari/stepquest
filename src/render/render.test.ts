import { describe, expect, it } from 'vitest'
import { Dir4, Dir8 } from '../tiles/autotile.ts'
import { Layer, Terrain, TileGrid } from '../tiles/grid.ts'
import { P } from './palette.ts'
import { CHECKPOINT, FINISH_FLAG, PLAYER_DOWN, spriteIsValid, START_MAT } from './sprites.ts'
import { pathCoverage, paintTile, tileHash, tileKey, type TileSpec } from './tileset.ts'
import { tileSpecAt } from './tileSpecs.ts'

/** Records the colour of every pixel painted into one 16×16 tile. */
class PixelCtx {
  fillStyle = ''
  readonly px: string[] = new Array(256).fill('')
  fillRect(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < 16 && yy < 16) this.px[yy * 16 + xx] = this.fillStyle
  }
  at(x: number, y: number) {
    return this.px[y * 16 + x]
  }
}

function paint(spec: Partial<TileSpec> & { terrain: TileSpec['terrain'] }) {
  const ctx = new PixelCtx()
  paintTile(ctx as unknown as CanvasRenderingContext2D, 0, 0, { m4: 0, m8: 255, variant: 7, vertical: false, ...spec })
  return ctx
}

describe('sprites', () => {
  it('are all 16×16 with known colours', () => {
    for (const s of [PLAYER_DOWN, CHECKPOINT, FINISH_FLAG, START_MAT]) expect(spriteIsValid(s)).toBe(true)
  })
})

describe('tile painter', () => {
  it('fills every pixel of every terrain', () => {
    for (const terrain of Object.values(Terrain)) {
      const ctx = paint({ terrain, m8: 0, m4: 0 })
      expect(ctx.px.every((c) => c !== ''), `terrain ${terrain}`).toBe(true)
    }
  })
  it('draws a sand shore only on open water edges', () => {
    const openNorth = paint({ terrain: Terrain.water, m8: 255 & ~Dir8.N & ~Dir8.NE & ~Dir8.NW })
    expect(openNorth.at(8, 0)).toBe(P.sand)
    expect(openNorth.at(8, 15)).not.toBe(P.sand)
    const inside = paint({ terrain: Terrain.water, m8: 255 })
    expect(inside.px.includes(P.sand)).toBe(false)
  })
  it('draws an inner corner when only the diagonal is missing', () => {
    const ctx = paint({ terrain: Terrain.road, m8: 255 & ~Dir8.SE })
    expect(ctx.at(15, 15)).toBe(P.curb)
    expect(ctx.at(0, 15)).not.toBe(P.curb)
  })
  it('draws building footprints as garden lawn (houses are drawn on top)', () => {
    const lot = paint({ terrain: Terrain.building, m8: 0 })
    expect(lot.px.includes(P.lawnA)).toBe(true)
    expect(lot.px.includes(P.wall)).toBe(false)
  })
  it('extends paths only towards connected neighbours', () => {
    const ew = pathCoverage(Dir4.E | Dir4.W)
    expect(ew[8 * 16 + 0]).toBe(true)
    expect(ew[8 * 16 + 15]).toBe(true)
    expect(ew[8]).toBe(false) // row 0, column 8
    const ctx = paint({ terrain: Terrain.path, m4: Dir4.N })
    expect([P.pathA, P.pathB, P.pathEdge]).toContain(ctx.at(8, 0))
    expect([P.pathA, P.pathB, P.pathEdge]).not.toContain(ctx.at(8, 15))
  })
  it('orients zebra bars with the walking direction', () => {
    const vertical = paint({ terrain: Terrain.crossing, vertical: true })
    expect(vertical.at(2, 1)).toBe(P.white)
    expect(vertical.at(2, 14)).toBe(P.white)
    const horizontal = paint({ terrain: Terrain.crossing, vertical: false })
    expect(horizontal.at(1, 2)).toBe(P.white)
    expect(horizontal.at(14, 2)).toBe(P.white)
  })
  it('keys tiles by everything that changes their pixels', () => {
    const base: TileSpec = { terrain: Terrain.park, m4: 0, m8: 255, variant: 1, vertical: false }
    expect(tileKey(base)).not.toBe(tileKey({ ...base, m8: 254 }))
    expect(tileKey(base)).not.toBe(tileKey({ ...base, variant: 2 }))
    expect(tileKey(base)).not.toBe(tileKey({ ...base, style: 2 }))
    expect(tileKey(base)).not.toBe(tileKey({ ...base, diag: 4 }))
    expect(tileKey(base)).not.toBe(tileKey({ ...base, barrier: 1, bm4: 10 }))
    expect(tileKey(base)).toBe(tileKey({ ...base }))
  })
  it('hashes tiles deterministically', () => {
    expect(tileHash(10, 20)).toBe(tileHash(10, 20))
    expect(tileHash(10, 20)).not.toBe(tileHash(20, 10))
  })
})

describe('tile specs from a grid', () => {
  const grid = new TileGrid({ south: 39.49, west: -0.4, north: 39.4905, east: -0.3994 }, 5)
  // Two separate building blocks and a road with a crossing.
  for (let x = 1; x <= 3; x++) for (let y = 1; y <= 2; y++) grid.add(x, y, Layer.building)
  for (let x = 6; x <= 7; x++) for (let y = 1; y <= 2; y++) grid.add(x, y, Layer.building)
  for (let x = 0; x < grid.cols; x++) grid.add(x, 5, Layer.road)
  grid.add(4, 4, Layer.path)
  grid.add(4, 5, Layer.path | Layer.crossing)
  grid.add(4, 6, Layer.path)
  grid.resolveTerrain()

  it('turns a footway across a road into a vertical zebra crossing', () => {
    const spec = tileSpecAt(grid, 4, 5)
    expect(spec.terrain).toBe(Terrain.crossing)
    expect(spec.vertical).toBe(true)
    expect(spec.m4 & (Dir4.N | Dir4.S)).toBe(Dir4.N | Dir4.S)
  })
})
