import { line4, type Pt } from '../tiles/rasterize.ts'

/** One tile the route passes through, in walking order, with the distance walked when entering it. */
export type RouteCell = { x: number; y: number; along: number }

/**
 * The route as an ordered chain of 4-connected tiles (no gaps, no diagonal
 * jumps), so it can be drawn as one continuous band on the tile grid.
 * Consecutive duplicates are dropped; revisits (out-and-back) are kept.
 */
export function routeCells(points: readonly Pt[], cumulative: readonly number[]): RouteCell[] {
  const out: RouteCell[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const startAlong = cumulative[i - 1] ?? 0
    const segLen = (cumulative[i] ?? startAlong) - startAlong
    const span = Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y))
    line4(a, b, (x, y) => {
      const last = out[out.length - 1]
      if (last && last.x === x && last.y === y) return
      // Distance along this segment at the tile centre's projection.
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * (b.x - a.x) + (y + 0.5 - a.y) * (b.y - a.y)) / (span * span)))
      out.push({ x, y, along: startAlong + segLen * t })
    })
  }
  return out
}

/**
 * Centre points for drawing the band: staircase corners (where the tiles
 * before and after are diagonal neighbours) are dropped, so the band runs
 * diagonally instead of zig-zagging. Units are tiles (cell centres).
 */
export function smoothPolyline(cells: readonly RouteCell[]): (RouteCell & { cx: number; cy: number })[] {
  const out: (RouteCell & { cx: number; cy: number })[] = []
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    const prev = out[out.length - 1]
    const next = cells[i + 1]
    if (prev && next && Math.abs(next.x - prev.x) === 1 && Math.abs(next.y - prev.y) === 1) continue
    out.push({ ...c, cx: c.x + 0.5, cy: c.y + 0.5 })
  }
  return out
}

/** One footprint along the route, in screen px. `angle` is the walking direction (radians). */
export type Footprint = { x: number; y: number; angle: number; left: boolean; along: number }

/**
 * Footprints along a screen polyline: one every `spacing` px, alternating
 * left and right of the line by `side` px and turned along the path. Points
 * carry the distance walked (`along`), interpolated onto each print. Spacing
 * is in screen px, so the density adapts to the zoom by itself. Pure.
 */
export function footprints(points: readonly { x: number; y: number; along: number }[], spacing: number, side: number): Footprint[] {
  const out: Footprint[] = []
  if (points.length < 2 || spacing <= 0) return out
  let next = spacing / 2
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    while (next <= travelled + len) {
      const t = (next - travelled) / len
      const left = out.length % 2 === 0
      // Screen y points down, so the walker's left is (uy, -ux).
      const s = left ? side : -side
      out.push({ x: a.x + (b.x - a.x) * t + uy * s, y: a.y + (b.y - a.y) * t - ux * s, angle: Math.atan2(uy, ux), left, along: a.along + (b.along - a.along) * t })
      next += spacing
    }
    travelled += len
  }
  return out
}

/** Direction index (0 = east, clockwise) for an angle, with `n` directions. */
export function dirIndex(angle: number, n: number): number {
  return ((Math.round(angle / ((Math.PI * 2) / n)) % n) + n) % n
}

export const FOOT_DIRS = 16

/**
 * Footprint art (9×9, f = sole, k = outline, . = clear) for each of 16
 * directions, left foot then right: an oval sole with a separate heel, the
 * sole slightly turned out. Rasterised from one shape so every direction
 * keeps the same weight (original pixel art).
 */
export const FOOT_PATTERNS: readonly (readonly (readonly string[])[])[] = [true, false].map((left) =>
  Array.from({ length: FOOT_DIRS }, (_, d) => {
    const a = (d * Math.PI * 2) / FOOT_DIRS
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const out = left ? -1 : 1
    const inFoot = (px: number, py: number) => {
      // Back into the foot's frame: x forward, y to the right of the walker (screen y down).
      const fx = px * cos + py * sin
      const fy = -px * sin + py * cos
      const sole = ((fx - 1.2) / 2.1) ** 2 + ((fy - 0.25 * out) / 1.35) ** 2 <= 1
      const heel = ((fx + 2.3) / 1.1) ** 2 + (fy / 1.05) ** 2 <= 1
      return sole || heel
    }
    const fill = (x: number, y: number) => x >= 0 && y >= 0 && x < 9 && y < 9 && inFoot(x - 4, y - 4)
    return Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => {
        if (fill(x, y)) return 'f'
        return fill(x + 1, y) || fill(x - 1, y) || fill(x, y + 1) || fill(x, y - 1) ? 'k' : '.'
      }).join(''),
    )
  }),
)
