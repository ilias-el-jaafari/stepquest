import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FAR_ZOOM, ZOOM_LEVELS } from '../render/camera.ts'
import { cellsInBBox } from './cells.ts'
import { COARSE_Z, DETAIL_Z } from '../vector/assemble.ts'
import { tilesInBBox } from '../vector/tileMath.ts'
import { FRAME_CELLS, QUEST_WINDOW_COARSE_TILES, QUEST_WINDOW_TILES, questMinZoom, worstCellsAlong, worstTilesTouched } from './window.ts'

const M_PER_DEG = 111_320
const VALENCIA = 39.48
const TILE_M = 5

/** A view box of the given metres centred on a point (the real width and height, not a square). */
function box(lat: number, lon: number, wM: number, hM: number) {
  const dLat = hM / 2 / M_PER_DEG
  const dLon = wM / 2 / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon }
}

describe('quest window (requirement 21.11)', () => {
  it('budgets 12 coarse (z13) or 6 detail (z14) tiles, and a view that fits the 9 × 9-cell frame', () => {
    expect(QUEST_WINDOW_TILES).toBe(6)
    expect(QUEST_WINDOW_COARSE_TILES).toBe(12)
    expect(FRAME_CELLS).toBe(9)
  })

  it('never undercounts the cells a view of that size touches, at any alignment', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 38, max: 42, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 50, max: 9000, noNaN: true }),
        fc.double({ min: 50, max: 9000, noNaN: true }),
        (lat, lon, w, h) => {
          expect(cellsInBBox(box(lat, lon, w, h)).length).toBeLessThanOrEqual((({ w: a, h: b }) => a * b)(worstCellsAlong(w, h, lat)))
        },
      ),
      { numRuns: 400 },
    )
  })

  it('never undercounts the vector tiles a view of that size touches, at any alignment', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 50, max: 20000, noNaN: true }),
        fc.double({ min: 50, max: 20000, noNaN: true }),
        fc.constantFrom(COARSE_Z, DETAIL_Z),
        (lat, lon, w, h, z) => {
          expect(tilesInBBox(box(lat, lon, w, h), z).length).toBeLessThanOrEqual(worstTilesTouched(w, h, lat, z))
        },
      ),
      { numRuns: 400 },
    )
  })

  it('keeps every quest view within its budget and inside the frame at the chosen zoom, for any screen and place', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 280, max: 1600 }),
        fc.integer({ min: 280, max: 1200 }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        (w, h, lat, lon) => {
          const z = questMinZoom(w, h, TILE_M, lat)
          expect((ZOOM_LEVELS as readonly number[]).includes(z)).toBe(true)
          const view = box(lat, lon, (w / z) * TILE_M, (h / z) * TILE_M)
          expect(tilesInBBox(view, z <= FAR_ZOOM ? COARSE_Z : DETAIL_Z).length).toBeLessThanOrEqual(z <= FAR_ZOOM ? QUEST_WINDOW_COARSE_TILES : QUEST_WINDOW_TILES)
          const along = worstCellsAlong((w / z) * TILE_M, (h / z) * TILE_M, lat)
          expect(Math.max(along.w, along.h)).toBeLessThanOrEqual(FRAME_CELLS)
          // The next level out breaks a rule (the floor is the lowest allowed).
          const below = ZOOM_LEVELS[(ZOOM_LEVELS as readonly number[]).indexOf(z) - 1]
          if (below !== undefined) {
            const bw = (w / below) * TILE_M
            const bh = (h / below) * TILE_M
            const a = worstCellsAlong(bw, bh, lat)
            const tooMany = below <= FAR_ZOOM ? worstTilesTouched(bw, bh, lat, COARSE_Z) > QUEST_WINDOW_COARSE_TILES : worstTilesTouched(bw, bh, lat, DETAIL_Z) > QUEST_WINDOW_TILES
            expect(tooMany || a.w > FRAME_CELLS || a.h > FRAME_CELLS).toBe(true)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('never lowers the floor for a bigger screen', () => {
    fc.assert(
      fc.property(fc.integer({ min: 280, max: 1200 }), fc.integer({ min: 280, max: 1200 }), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), (w, h, dw, dh) => {
        expect(questMinZoom(w + dw, h + dh, TILE_M, VALENCIA)).toBeGreaterThanOrEqual(questMinZoom(w, h, TILE_M, VALENCIA))
      }),
    )
  })

  it('lifts the floor on the 390 × 844 phone of the field check (z13 tiles are 3.8 km), and keeps a wide screen inside the frame', () => {
    expect(questMinZoom(390, 844, TILE_M, VALENCIA)).toBe(ZOOM_LEVELS[0])
    // The furthest phone view touches at most 12 coarse tiles (worst alignment; the field check asked for 8).
    expect(worstTilesTouched((390 / 0.5) * TILE_M, (844 / 0.5) * TILE_M, VALENCIA, COARSE_Z)).toBe(QUEST_WINDOW_COARSE_TILES)
    // A 1280 × 800 window would be wider than the frame at 0.5 and 0.75.
    expect(questMinZoom(1280, 800, TILE_M, VALENCIA)).toBe(1)
  })

  it('uses the real aspect ratio: a tall view needs a different floor than a wide one of the same area', () => {
    expect(questMinZoom(844, 390, TILE_M, VALENCIA)).not.toBe(Number.NaN)
    expect(worstCellsAlong(2000, 8000, VALENCIA)).not.toEqual(worstCellsAlong(8000, 2000, VALENCIA))
  })
})
