import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Layer, Terrain, TileGrid } from '../tiles/grid.ts'
import { evenSubset, FLICKER_DEPTH, flicker, LAMP_SPACING, streetLamps, lampsInChunk } from './lamps.ts'

const SEED = 20261204
const BBOX = { south: 39.49, north: 39.4935, west: -0.4, east: -0.39 }

/** A grid with horizontal streets, each `[y, thickness, lit]`, one tile of ground between them. */
function streets(spec: [number, number, boolean][]): TileGrid {
  const g = new TileGrid(BBOX)
  for (const [y0, t, lit] of spec) for (let x = 0; x < g.cols; x++) for (let y = y0; y < y0 + t && y < g.rows; y++) g.add(x, y, lit ? Layer.road | Layer.lit : Layer.road)
  g.resolveTerrain()
  return g
}

const specArb = fc
  .array(fc.record({ gap: fc.integer({ min: 2, max: 12 }), thick: fc.integer({ min: 2, max: 4 }), lit: fc.boolean() }), { minLength: 1, maxLength: 4 })
  .map((rows) => {
    let y = 2
    return rows.map((r) => {
      y += r.gap
      const out: [number, number, boolean] = [y, r.thick, r.lit]
      y += r.thick
      return out
    })
  })

describe('lamp placement (properties)', () => {
  it('P-N1 lamps stand on road kerbs, never twice on a tile, and the same grid gives the same lamps', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const g = streets(spec)
        const lamps = streetLamps(g)
        expect(streetLamps(streets(spec))).toEqual(lamps)
        const seen = new Set<number>()
        for (const l of lamps) {
          const i = l.y * g.cols + l.x
          expect([Terrain.road, Terrain.crossing]).toContain(g.terrain[i])
          const road = (x: number, y: number) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && [Terrain.road, Terrain.crossing].includes(g.terrain[y * g.cols + x] as never)
          expect(!road(l.x, l.y - 1) || !road(l.x, l.y + 1) || !road(l.x - 1, l.y) || !road(l.x + 1, l.y)).toBe(true)
          expect(seen.has(i)).toBe(false)
          seen.add(i)
        }
      }),
      { seed: SEED },
    )
  })

  it('P-N2 lamps on one kerb of a street are 2 × LAMP_SPACING tiles apart', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const g = streets(spec)
        const byRow = new Map<number, number[]>()
        // The map's own edge is a kerb too (a street end); spacing is about the street's length.
        for (const l of streetLamps(g).filter((p) => p.x > 0 && p.x < g.cols - 1)) byRow.set(l.y, [...(byRow.get(l.y) ?? []), l.x])
        for (const xs of byRow.values()) {
          xs.sort((a, b) => a - b)
          for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(LAMP_SPACING * 2)
        }
      }),
      { seed: SEED },
    )
  })

  it('P-N3 the lamps of a grid do not depend on the chunk size they are asked for in', () => {
    fc.assert(
      fc.property(specArb, fc.constantFrom(8, 16, 32), (spec, size) => {
        const g = streets(spec)
        const all = streetLamps(g)
        const got: string[] = []
        for (let cy = 0; cy * size < g.rows; cy++) for (let cx = 0; cx * size < g.cols; cx++) for (const l of lampsInChunk(g, cx, cy, size)) got.push(`${l.x},${l.y}`)
        expect(got.sort()).toEqual(all.map((l) => `${l.x},${l.y}`).sort())
      }),
      { seed: SEED },
    )
  })

  it('P-N4 evenSubset keeps at most the cap, in order, the same every call, and the list when it fits', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 80 }), fc.integer({ min: 1, max: 30 }), (list, cap) => {
        const a = evenSubset(list, cap)
        expect(a.length).toBe(Math.min(list.length, cap))
        expect(evenSubset(list, cap)).toEqual(a)
        if (list.length <= cap) expect(a).toBe(list)
        else {
          // Each kept item comes from its own stretch of the list: no clumping at the start.
          const idx = a.map((_, i) => Math.floor((i * list.length) / cap))
          expect(new Set(idx).size).toBe(cap)
          expect(idx[idx.length - 1]!).toBeGreaterThanOrEqual(list.length - Math.ceil(list.length / cap))
        }
      }),
      { seed: SEED },
    )
  })

  it('P-N5 flicker stays within 8 % and is exactly 1 with reduced motion', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 1e9 }), (x, y, now) => {
        const f = flicker({ x, y }, now, false)
        expect(f).toBeGreaterThanOrEqual(1 - FLICKER_DEPTH)
        expect(f).toBeLessThanOrEqual(1)
        expect(flicker({ x, y }, now, true)).toBe(1)
        expect(flicker({ x, y }, now, false)).toBe(f)
      }),
      { seed: SEED },
    )
  })
})
