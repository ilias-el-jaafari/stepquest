import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BLOB_MASKS, Dir4, Dir8, mask4At, mask8At } from './autotile.ts'
import { Terrain, type TerrainId } from './grid.ts'

/**
 * Auto-tile mask properties on random grids (P-T1 to P-T6). A grid here is a plain array of terrain
 * ids; the lookup returns undefined outside it, like `TileGrid.terrainAt`.
 */
const TERRAINS = Object.values(Terrain) as TerrainId[]
type G = { w: number; h: number; t: TerrainId[] }
const at = (g: G) => (x: number, y: number): TerrainId | undefined => (x < 0 || y < 0 || x >= g.w || y >= g.h ? undefined : g.t[y * g.w + x])

const grids = fc.record({ w: fc.integer({ min: 1, max: 9 }), h: fc.integer({ min: 1, max: 9 }) }).chain(({ w, h }) =>
  fc.array(fc.constantFrom(...TERRAINS), { minLength: w * h, maxLength: w * h }).map((t): G => ({ w, h, t })),
)
const seed = 20261204

/** 90° clockwise: tile (x, y) moves to (h - 1 - y, x). */
function rotate(g: G): G {
  const t: TerrainId[] = new Array(g.w * g.h)
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) t[x * g.h + (g.h - 1 - y)] = g.t[y * g.w + x]!
  return { w: g.h, h: g.w, t }
}
const rotl = (m: number, n: number, bits: number) => ((m << n) | (m >> (bits - n))) & ((1 << bits) - 1)

describe('auto-tile masks on random grids', () => {
  it('P-T1 every 8-bit mask is one of the 47 blob masks; a diagonal needs both cardinals beside it', () => {
    fc.assert(
      fc.property(grids, (g) => {
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const m = mask8At(at(g), x, y)
            expect(BLOB_MASKS).toContain(m)
            if (m & Dir8.NE) expect(m & Dir8.N && m & Dir8.E).toBeTruthy()
            if (m & Dir8.SE) expect(m & Dir8.S && m & Dir8.E).toBeTruthy()
            if (m & Dir8.SW) expect(m & Dir8.S && m & Dir8.W).toBeTruthy()
            if (m & Dir8.NW) expect(m & Dir8.N && m & Dir8.W).toBeTruthy()
          }
      }),
      { seed },
    )
  })

  it('P-T2 the map edge counts as connected: the bit towards the outside is always set', () => {
    fc.assert(
      fc.property(grids, (g) => {
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const m4 = mask4At(at(g), x, y)
            const m8 = mask8At(at(g), x, y)
            if (y === 0) expect(m4 & Dir4.N && m8 & Dir8.N).toBeTruthy()
            if (x === g.w - 1) expect(m4 & Dir4.E && m8 & Dir8.E).toBeTruthy()
            if (y === g.h - 1) expect(m4 & Dir4.S && m8 & Dir8.S).toBeTruthy()
            if (x === 0) expect(m4 & Dir4.W && m8 & Dir8.W).toBeTruthy()
          }
      }),
      { seed },
    )
  })

  it('P-T3 the 4-bit mask is the cardinal part of the 8-bit mask', () => {
    fc.assert(
      fc.property(grids, (g) => {
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const m4 = mask4At(at(g), x, y)
            const m8 = mask8At(at(g), x, y)
            const from8 = (m8 & Dir8.N ? Dir4.N : 0) | (m8 & Dir8.E ? Dir4.E : 0) | (m8 & Dir8.S ? Dir4.S : 0) | (m8 & Dir8.W ? Dir4.W : 0)
            expect(m4).toBe(from8)
          }
      }),
      { seed },
    )
  })

  it('P-T4 a mask depends only on the 3 × 3 neighbourhood', () => {
    fc.assert(
      fc.property(grids, fc.nat(), fc.constantFrom(...TERRAINS), (g, pick, terrain) => {
        const x = pick % g.w
        const y = Math.floor(pick / g.w) % g.h
        const before = [mask4At(at(g), x, y), mask8At(at(g), x, y)]
        const t = [...g.t]
        for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (Math.max(Math.abs(i - x), Math.abs(j - y)) >= 2) t[j * g.w + i] = terrain
        const g2 = { ...g, t }
        expect([mask4At(at(g2), x, y), mask8At(at(g2), x, y)]).toEqual(before)
      }),
      { seed },
    )
  })

  it('P-T5 turning the grid 90° clockwise turns every mask the same way', () => {
    fc.assert(
      fc.property(grids, (g) => {
        const r = rotate(g)
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++) {
            const nx = g.h - 1 - y
            const ny = x
            expect(mask4At(at(r), nx, ny)).toBe(rotl(mask4At(at(g), x, y), 1, 4))
            // Clockwise by 90° moves each direction two places round the 8-bit ring, and the reduction commutes with that.
            expect(mask8At(at(r), nx, ny)).toBe(rotl(mask8At(at(g), x, y), 2, 8))
          }
      }),
      { seed },
    )
  })

  it('P-T6 a field of one terrain has no borders anywhere', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TERRAINS), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), (terrain, w, h) => {
        const g: G = { w, h, t: new Array(w * h).fill(terrain) }
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            expect(mask8At(at(g), x, y)).toBe(255)
            expect(mask4At(at(g), x, y)).toBe(15)
          }
      }),
      { seed },
    )
  })
})
