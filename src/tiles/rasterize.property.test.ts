import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fillPolygon, fillRings, line4, polygonArea, thickSegment, type Pt } from './rasterize.ts'

const SEED = 20261204
const key = (x: number, y: number) => `${x},${y}`

const cellsOf = (run: (visit: (x: number, y: number) => void) => void) => {
  const cells = new Set<string>()
  run((x, y) => cells.add(key(x, y)))
  return cells
}

/** A convex polygon: points on an ellipse around a random centre. */
const ellipse = fc
  .record({
    cx: fc.double({ min: -20, max: 120, noNaN: true }),
    cy: fc.double({ min: -20, max: 120, noNaN: true }),
    rx: fc.double({ min: 3, max: 45, noNaN: true }),
    ry: fc.double({ min: 3, max: 45, noNaN: true }),
    n: fc.integer({ min: 8, max: 48 }),
    turn: fc.double({ min: 0, max: Math.PI, noNaN: true }),
  })
  .map(({ cx, cy, rx, ry, n, turn }): Pt[] =>
    Array.from({ length: n }, (_, i) => {
      const a = turn + (i / n) * 2 * Math.PI
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }
    }),
  )

const perimeter = (pts: Pt[]) => pts.reduce((s, p, i) => s + Math.hypot(p.x - pts[(i + pts.length - 1) % pts.length]!.x, p.y - pts[(i + pts.length - 1) % pts.length]!.y), 0)

describe('rasterizer properties (task 66.3)', () => {
  it('P-T1: the tiles of a filled convex polygon number its true area within half its perimeter', () => {
    fc.assert(
      fc.property(ellipse, (pts) => {
        const cells = cellsOf((v) => fillPolygon(pts, v))
        expect(Math.abs(cells.size - polygonArea(pts))).toBeLessThanOrEqual(perimeter(pts) / 2 + 1)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-T2: the fill is the same inside any bounds, restricted to those bounds', () => {
    fc.assert(
      fc.property(ellipse, fc.integer({ min: 10, max: 90 }), fc.integer({ min: 10, max: 90 }), (pts, cols, rows) => {
        const all = cellsOf((v) => fillPolygon(pts, v))
        const clipped = cellsOf((v) => fillPolygon(pts, v, { cols, rows }))
        const expected = new Set([...all].filter((c) => {
          const [x, y] = c.split(',').map(Number) as [number, number]
          return x >= 0 && y >= 0 && x < cols && y < rows
        }))
        expect(clipped).toEqual(expected)
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('P-T3: a hole stays empty and the rest of the outline stays filled', () => {
    const box = fc
      .record({
        x: fc.integer({ min: 0, max: 40 }),
        y: fc.integer({ min: 0, max: 40 }),
        w: fc.integer({ min: 6, max: 50 }),
        h: fc.integer({ min: 6, max: 50 }),
        ix: fc.integer({ min: 1, max: 4 }),
        iy: fc.integer({ min: 1, max: 4 }),
        iw: fc.integer({ min: 1, max: 20 }),
        ih: fc.integer({ min: 1, max: 20 }),
      })
      .filter((r) => r.ix + r.iw < r.w && r.iy + r.ih < r.h)
    const rect = (x0: number, y0: number, w: number, h: number): Pt[] => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }]
    fc.assert(
      fc.property(box, ({ x, y, w, h, ix, iy, iw, ih }) => {
        const cells = cellsOf((v) => fillRings([rect(x, y, w, h), rect(x + ix, y + iy, iw, ih)], v))
        expect(cells.size).toBe(w * h - iw * ih)
        for (let ty = y + iy; ty < y + iy + ih; ty++) for (let tx = x + ix; tx < x + ix + iw; tx++) expect(cells.has(key(tx, ty))).toBe(false)
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('P-T4: moving a polygon by whole tiles moves its fill by the same tiles', () => {
    fc.assert(
      fc.property(ellipse, fc.integer({ min: -30, max: 30 }), fc.integer({ min: -30, max: 30 }), (pts, dx, dy) => {
        const a = cellsOf((v) => fillPolygon(pts, v))
        const b = cellsOf((v) => fillPolygon(pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), v))
        const moved = new Set([...a].map((c) => { const [x, y] = c.split(',').map(Number) as [number, number]; return key(x + dx, y + dy) }))
        expect(b).toEqual(moved)
      }),
      { seed: SEED, numRuns: 150 },
    )
  })

  it('P-T5: the row-limited thick segment marks exactly the tiles of the brute-force test, plus the 4-connected centre line', () => {
    const point = fc.record({ x: fc.double({ min: -5, max: 80, noNaN: true }), y: fc.double({ min: -5, max: 80, noNaN: true }) })
    fc.assert(
      fc.property(point, point, fc.double({ min: 0.2, max: 4, noNaN: true }), (a, b, half) => {
        const brute = new Set<string>()
        const vx = b.x - a.x
        const vy = b.y - a.y
        const len2 = vx * vx + vy * vy
        for (let ty = Math.floor(Math.min(a.y, b.y) - half); ty <= Math.ceil(Math.max(a.y, b.y) + half); ty++) {
          for (let tx = Math.floor(Math.min(a.x, b.x) - half); tx <= Math.ceil(Math.max(a.x, b.x) + half); tx++) {
            const cx = tx + 0.5
            const cy = ty + 0.5
            const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - a.x) * vx + (cy - a.y) * vy) / len2))
            if ((a.x + t * vx - cx) ** 2 + (a.y + t * vy - cy) ** 2 <= half * half) brute.add(key(tx, ty))
          }
        }
        for (const c of cellsOf((v) => line4(a, b, v))) brute.add(c)
        expect(cellsOf((v) => thickSegment(a, b, half, v))).toEqual(brute)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-T6: a line clipped to the grid stays 4-connected, inside the grid margin, and keeps the end that is inside', () => {
    const bounds = { cols: 60, rows: 60 }
    const inside = fc.record({ x: fc.double({ min: 0, max: 59.99, noNaN: true }), y: fc.double({ min: 0, max: 59.99, noNaN: true }) })
    const anywhere = fc.record({ x: fc.double({ min: -1e5, max: 1e5, noNaN: true }), y: fc.double({ min: -1e5, max: 1e5, noNaN: true }) })
    fc.assert(
      fc.property(inside, anywhere, (a, b) => {
        const cells = [...cellsOf((v) => line4(a, b, v, bounds))].map((c) => c.split(',').map(Number) as [number, number])
        expect(cells.every(([x, y]) => x >= -1 && y >= -1 && x <= 61 && y <= 61)).toBe(true)
        expect(cells.some(([x, y]) => x === Math.floor(a.x) && y === Math.floor(a.y))).toBe(true)
        const set = new Set(cells.map(([x, y]) => key(x, y)))
        const seen = new Set([key(...cells[0]!)])
        const queue = [cells[0]!]
        while (queue.length) {
          const [x, y] = queue.pop()!
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const k = key(x + dx, y + dy)
            if (set.has(k) && !seen.has(k)) {
              seen.add(k)
              queue.push([x + dx, y + dy])
            }
          }
        }
        expect(seen.size).toBe(set.size)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })
})
