import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cellBBox, cellCentre, cellDistanceM, cellKey, cellOf, cellsBBox, cellsInBBox, isValidCell, nearestFirst, parseCellKey, planBatch, MAX_BATCH_CELLS, type CellId } from './cells.ts'

const lat = fc.double({ min: -80, max: 80, noNaN: true })
const lon = fc.double({ min: -179, max: 179, noNaN: true })

describe('cell grid', () => {
  it('names the Benicalap cell', () => {
    expect(cellOf({ lat: 39.4935, lon: -0.392 })).toEqual({ i: 3949, j: -40 })
    expect(cellBBox({ i: 3949, j: -40 })).toEqual({ south: 39.49, west: -0.4, north: 39.5, east: -0.39 })
  })

  it('keeps a point on a shared edge in the cell north-east of it, whatever the float noise', () => {
    expect(cellOf({ lat: 39.48, lon: -0.4 })).toEqual({ i: 3948, j: -40 })
    expect(cellOf({ lat: 0.3, lon: 0.7 })).toEqual({ i: 30, j: 70 })
    expect(cellOf({ lat: -0.01, lon: -0.01 })).toEqual({ i: -1, j: -1 })
  })

  it('round-trips keys', () => {
    expect(parseCellKey(cellKey({ i: -3, j: 12 }))).toEqual({ i: -3, j: 12 })
    expect(parseCellKey('x,1')).toBeUndefined()
  })

  it('P-C1 every point lies in the box of its own cell', () => {
    fc.assert(
      fc.property(lat, lon, (la, lo) => {
        const b = cellBBox(cellOf({ lat: la, lon: lo }))
        expect(la).toBeGreaterThanOrEqual(b.south - 1e-9)
        expect(la).toBeLessThanOrEqual(b.north + 1e-9)
        expect(lo).toBeGreaterThanOrEqual(b.west - 1e-9)
        expect(lo).toBeLessThanOrEqual(b.east + 1e-9)
      }),
    )
  })

  it('P-C2 neighbours share an edge exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: -8000, max: 8000 }), fc.integer({ min: -17000, max: 17000 }), (i, j) => {
        expect(cellBBox({ i, j }).north).toBe(cellBBox({ i: i + 1, j }).south)
        expect(cellBBox({ i, j }).east).toBe(cellBBox({ i, j: j + 1 }).west)
      }),
    )
  })

  it('P-C3 the cells of a box cover it and none is a stranger', () => {
    fc.assert(
      fc.property(lat, lon, fc.double({ min: 0.0001, max: 0.05, noNaN: true }), fc.double({ min: 0.0001, max: 0.05, noNaN: true }), (la, lo, h, w) => {
        const box = { south: la, west: lo, north: la + h, east: lo + w }
        const cells = cellsInBBox(box)
        const union = cellsBBox(cells)
        expect(union.south).toBeLessThanOrEqual(box.south + 1e-9)
        expect(union.north).toBeGreaterThanOrEqual(box.north - 1e-9)
        expect(union.west).toBeLessThanOrEqual(box.west + 1e-9)
        expect(union.east).toBeGreaterThanOrEqual(box.east - 1e-9)
        for (const c of cells) {
          const b = cellBBox(c)
          expect(b.north).toBeGreaterThan(box.south - 1e-9)
          expect(b.south).toBeLessThan(box.north + 1e-9)
        }
      }),
    )
  })

  it('does not take the cell beyond an edge a box only touches', () => {
    const cells = cellsInBBox({ south: 39.48, west: -0.41, north: 39.5, east: -0.39 })
    expect(cells).toHaveLength(4)
    expect(cellsInBBox({ south: 1, west: 1, north: 0, east: 2 })).toEqual([])
    expect(cellsInBBox({ south: NaN, west: 1, north: 2, east: 2 })).toEqual([])
  })

  it('rejects cells outside the valid map', () => {
    expect(isValidCell({ i: 3949, j: -40 })).toBe(true)
    expect(isValidCell({ i: 1.5, j: 0 })).toBe(false)
    expect(isValidCell({ i: 9000, j: 0 })).toBe(false)
    expect(isValidCell({ i: 0, j: 18000 })).toBe(false)
  })

  it('orders cells nearest first, containing cell first, stable on ties', () => {
    const here = { lat: 39.4935, lon: -0.392 }
    const cells: CellId[] = [
      { i: 3951, j: -40 },
      { i: 3949, j: -40 },
      { i: 3949, j: -39 },
      { i: 3948, j: -40 },
    ]
    const sorted = nearestFirst(cells, here)
    expect(sorted[0]).toEqual({ i: 3949, j: -40 })
    expect(sorted.at(-1)).toEqual({ i: 3951, j: -40 })
    expect(nearestFirst([...cells].reverse(), here)).toEqual(sorted)
    expect(cellDistanceM({ i: 3949, j: -40 }, here)).toBe(0)
    expect(cellDistanceM({ i: 3951, j: -40 }, here)).toBeGreaterThan(1000)
    expect(cellCentre({ i: 0, j: 0 })).toEqual({ lat: 0.005, lon: 0.005 })
  })

  describe('batches', () => {
    const grid = (rows: number, cols: number): CellId[] => {
      const out: CellId[] = []
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out.push({ i, j })
      return out
    }

    it('takes a 2 × 2 block when all four are wanted', () => {
      const batch = planBatch(grid(2, 2))
      expect(batch).toHaveLength(4)
    })

    it('never exceeds the limit and never includes an unwanted cell', () => {
      fc.assert(
        fc.property(fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 })), { minLength: 1, maxLength: 25 }), (pairs) => {
          const wanted = pairs.map(([i, j]) => ({ i, j }))
          const batch = planBatch(wanted)
          expect(batch.length).toBeGreaterThanOrEqual(1)
          expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_CELLS)
          expect(batch).toContainEqual(wanted[0])
          const keys = new Set(wanted.map(cellKey))
          for (const c of batch) expect(keys.has(cellKey(c))).toBe(true)
          // A rectangle: its bounding box holds exactly the batch.
          const b = cellsBBox(batch)
          expect(cellsInBBox(b)).toHaveLength(batch.length)
        }),
      )
    })

    it('falls back to a single cell and to nothing', () => {
      expect(planBatch([{ i: 5, j: 5 }, { i: 9, j: 9 }])).toEqual([{ i: 5, j: 5 }])
      expect(planBatch([])).toEqual([])
    })
  })
})
