import { makeCanvas } from './env.ts'
import { P } from './palette.ts'
import { dirIndex, FOOT_DIRS, FOOT_PATTERNS, footprints, type Footprint } from './routePath.ts'
import { type View } from './view.ts'

export type RouteLine = readonly { cx: number; cy: number; along: number }[]

/** Footprint art is 9 × 9 art pixels. */
export const FOOT_SIZE = 9

/** One footprint as a cached canvas: `px` device px per art pixel, ahead or walked colours. */
const stamps = new Map<string, HTMLCanvasElement>()
function stamp(left: boolean, dir: number, done: boolean, px: number): HTMLCanvasElement {
  const key = `${left ? 1 : 0}:${dir}:${done ? 1 : 0}:${px}`
  let c = stamps.get(key)
  if (!c) {
    c = makeCanvas(FOOT_SIZE * px, FOOT_SIZE * px)
    const ctx = c.getContext('2d')!
    const rows = FOOT_PATTERNS[left ? 0 : 1]![dir]!
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const ch = row[xx]
        if (ch === '.') continue
        ctx.fillStyle = ch === 'k' ? (done ? P.routeShadow : P.ink) : done ? P.routeWalked : P.route
        ctx.fillRect(xx * px, yy * px, px, px)
      }
    })
    stamps.set(key, c)
  }
  return c
}

/**
 * A trail of footprints along one route line. The layout (spacing, side, direction) depends only on
 * the zoom, so it is computed once per `scale` and `px` in world pixels; a frame just offsets it by
 * the integer map origin, skips what is off screen and draws one cached stamp per print.
 */
export class FootprintLayer {
  private line: RouteLine = []
  private layout: { scale: number; px: number; prints: Footprint[] } | undefined

  setLine(line: RouteLine): void {
    this.line = line
    this.layout = undefined
  }

  get isEmpty(): boolean {
    return this.line.length < 2
  }

  /** Prints in world pixels (the screen position minus the map origin), for tests and the frame loop. */
  prints(scale: number, px: number): Footprint[] {
    if (this.layout?.scale !== scale || this.layout.px !== px) {
      const pts = this.line.map((c) => ({ x: c.cx * scale, y: c.cy * scale, along: c.along }))
      this.layout = { scale, px, prints: footprints(pts, 7 * px, 2 * px) }
    }
    return this.layout.prints
  }

  /** Draw the trail; prints up to `walked` metres along are darker and faded. Returns how many were drawn. */
  draw(ctx: CanvasRenderingContext2D, view: View, px: number, walked: number): number {
    const prints = this.prints(view.scale, px)
    const size = FOOT_SIZE * px
    const margin = 12 * px
    let drawn = 0
    for (const f of prints) {
      const x = view.originX + f.x
      const y = view.originY + f.y
      if (!(x > -margin && y > -margin && x < view.w + margin && y < view.h + margin)) continue
      const done = f.along <= walked
      ctx.globalAlpha = done ? 0.6 : 1
      ctx.drawImage(stamp(f.left, dirIndex(f.angle, FOOT_DIRS), done, px), Math.round(x - size / 2), Math.round(y - size / 2))
      drawn++
    }
    ctx.globalAlpha = 1
    return drawn
  }
}
