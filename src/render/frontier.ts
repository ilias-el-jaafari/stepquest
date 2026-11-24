import { makeCanvas } from './env.ts'
import type { FrontierEdge } from './mapSource.ts'
import { P } from './palette.ts'
import { tileEdgeX, tileEdgeY, type View } from './view.ts'

/** Depth of one fog step in CSS px, so the band looks the same at every zoom (requirement 19.21). */
export const FOG_STEP_CSS = 8
/** Ground-coloured dots out of 16 for each step, from the edge inwards. */
export const FOG_DENSITY = [14, 11, 8, 5, 2] as const
const DOT = 2

/** Bayer 4 × 4 ranks: a cell is covered at density `d` when its rank is below `d`. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

const patterns = new Map<number, CanvasPattern | null>()

/** A tile of no-data ground dots at `density`/16 (transparent elsewhere), as a repeating pattern. */
function pattern(ctx: CanvasRenderingContext2D, density: number): CanvasPattern | null {
  if (patterns.has(density)) return patterns.get(density)!
  const size = 4 * DOT
  const c = makeCanvas(size, size)
  const g = c.getContext('2d')!
  g.fillStyle = P.groundB
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y]![x]! < density) g.fillRect(x * DOT, y * DOT, DOT, DOT)
  const p = typeof ctx.createPattern === 'function' ? ctx.createPattern(c, 'repeat') : null
  patterns.set(density, p)
  return p
}

/**
 * Fade the loaded side of every frontier edge into the no-data ground: five bands of ordered dither,
 * dense at the edge, sparse inside, so the map ends in fog and not in a straight cut. Only the ground
 * colour is used. The bands are `FOG_STEP_CSS` deep on screen whatever the zoom.
 */
export function drawFrontier(ctx: CanvasRenderingContext2D, v: View, edges: readonly FrontierEdge[]): void {
  const step = Math.max(2, Math.round(FOG_STEP_CSS * v.dpr))
  for (const e of edges) {
    const horizontal = e.side === 'n' || e.side === 's'
    const a0 = horizontal ? tileEdgeX(v, e.x) : tileEdgeY(v, e.y)
    const a1 = horizontal ? tileEdgeX(v, e.x + e.len) : tileEdgeY(v, e.y + e.len)
    const edge = horizontal ? tileEdgeY(v, e.y) : tileEdgeX(v, e.x)
    const limit = horizontal ? v.h : v.w
    const across = horizontal ? v.w : v.h
    if (a1 <= 0 || a0 >= across) continue
    // Direction into the loaded side: down or right for n and w, up or left for s and e.
    const dir = e.side === 'n' || e.side === 'w' ? 1 : -1
    for (let k = 0; k < FOG_DENSITY.length; k++) {
      const from = edge + dir * k * step
      const to = edge + dir * (k + 1) * step
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      if (hi <= 0 || lo >= limit) continue
      const pat = pattern(ctx, FOG_DENSITY[k]!)
      if (!pat) continue
      ctx.fillStyle = pat
      const s0 = Math.max(0, a0)
      const s1 = Math.min(across, a1)
      if (horizontal) ctx.fillRect(s0, lo, s1 - s0, hi - lo)
      else ctx.fillRect(lo, s0, hi - lo, s1 - s0)
    }
  }
}
