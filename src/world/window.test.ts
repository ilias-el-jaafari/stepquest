import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FAR_ZOOM, ZOOM_LEVELS } from '../render/camera.ts'
import { cellsInBBox } from './cells.ts'
import { regionsOfCells } from './regions.ts'
import { QUEST_WINDOW_CELLS, QUEST_WINDOW_REGIONS, questMinZoom, worstCellsTouched, worstRegionsTouched } from './window.ts'

const M_PER_DEG = 111_320
const VALENCIA = 39.48
const TILE_M = 5

/** A view box of the given metres centred on a point (the real width and height, not a square). */
function box(lat: number, lon: number, wM: number, hM: number) {
  const dLat = hM / 2 / M_PER_DEG
  const dLon = wM / 2 / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon }
}

describe('quest window (requirement 20.8)', () => {
  it('budgets about 12 km² of detail and 4 coarse regions', () => {
    expect(QUEST_WINDOW_CELLS).toBe(12)
    expect(QUEST_WINDOW_REGIONS).toBe(4)
  })

  it('never undercounts the cells a view of that size touches, at any alignment', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 38, max: 42, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 50, max: 9000, noNaN: true }),
        fc.double({ min: 50, max: 9000, noNaN: true }),
        (lat, lon, w, h) => {
          expect(cellsInBBox(box(lat, lon, w, h)).length).toBeLessThanOrEqual(worstCellsTouched(w, h, lat))
        },
      ),
      { numRuns: 400 },
    )
  })

  it('never undercounts the regions a view of that size touches, at any alignment', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 38, max: 42, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 50, max: 20000, noNaN: true }),
        fc.double({ min: 50, max: 20000, noNaN: true }),
        (lat, lon, w, h) => {
          expect(regionsOfCells(cellsInBBox(box(lat, lon, w, h))).length).toBeLessThanOrEqual(worstRegionsTouched(w, h, lat))
        },
      ),
      { numRuns: 400 },
    )
  })

  it('keeps every quest view within its budget at the chosen zoom, for any screen and place', () => {
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
          // At or below FAR_ZOOM the coarse layer serves the view: regions are counted; above it, detail cells.
          if (z <= FAR_ZOOM) expect(regionsOfCells(cellsInBBox(view)).length).toBeLessThanOrEqual(QUEST_WINDOW_REGIONS)
          else expect(cellsInBBox(view).length).toBeLessThanOrEqual(QUEST_WINDOW_CELLS)
          // And the next level out would break its budget (the floor is the lowest allowed).
          const below = ZOOM_LEVELS[(ZOOM_LEVELS as readonly number[]).indexOf(z) - 1]
          if (below !== undefined) {
            const bw = (w / below) * TILE_M
            const bh = (h / below) * TILE_M
            if (below <= FAR_ZOOM) expect(worstRegionsTouched(bw, bh, lat)).toBeGreaterThan(QUEST_WINDOW_REGIONS)
            else expect(worstCellsTouched(bw, bh, lat)).toBeGreaterThan(QUEST_WINDOW_CELLS)
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

  it('on the 390 × 844 phone of the field check the floor drops from 1.5 to 1, where the coarse layer draws the view', () => {
    const z = questMinZoom(390, 844, TILE_M, VALENCIA)
    expect(z).toBe(1)
    expect(z).toBeLessThanOrEqual(FAR_ZOOM)
    // The old rule (12 detail cells at every zoom) would have stopped at 1.5.
    expect(worstCellsTouched((390 / 1) * TILE_M, (844 / 1) * TILE_M, VALENCIA)).toBeGreaterThan(QUEST_WINDOW_CELLS)
    // At the furthest zoom the view still needs more regions than the budget.
    expect(worstRegionsTouched((390 / 0.5) * TILE_M, (844 / 0.5) * TILE_M, VALENCIA)).toBeGreaterThan(QUEST_WINDOW_REGIONS)
  })

  it('uses the real aspect ratio: a tall view needs a different floor than a wide one of the same area', () => {
    expect(questMinZoom(844, 390, TILE_M, VALENCIA)).not.toBe(Number.NaN)
    expect(worstCellsTouched(2000, 8000, VALENCIA)).not.toBe(worstCellsTouched(8000, 2000, VALENCIA))
  })
})
