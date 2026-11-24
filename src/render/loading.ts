import type { TileRect } from '../tiles/grid.ts'
import { makeCanvas } from './env.ts'
import { P } from './palette.ts'
import { tileEdgeX, tileEdgeY, type View } from './view.ts'

/** Side of the stipple texture in device px (one texture, drawn tiled; about 60 draws for a phone screen). */
export const STIPPLE_PX = 256
const DOT = 2
const STEP = 8

let texture: HTMLCanvasElement | undefined

/** The "still loading" ground: the no-data green with a sparse diagonal dot lattice. Never black. */
export function stippleTexture(): HTMLCanvasElement {
  if (texture && texture.width > 0) return texture
  const c = makeCanvas(STIPPLE_PX, STIPPLE_PX)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = P.groundB
  ctx.fillRect(0, 0, STIPPLE_PX, STIPPLE_PX)
  ctx.fillStyle = P.groundDot
  for (let y = 0; y < STIPPLE_PX; y += STEP) for (let x = (y / STEP) % 2 === 0 ? 0 : STEP / 2; x < STIPPLE_PX; x += STEP) ctx.fillRect(x, y, DOT, DOT)
  texture = c
  return c
}

/**
 * Cover the tile rectangles of cells still loading with the stipple. The texture is anchored to the
 * map (it moves with a pan) and clipped to each rectangle, so neighbouring loaded tiles stay clean.
 */
export function drawLoading(ctx: CanvasRenderingContext2D, v: View, rects: readonly TileRect[]): void {
  const tex = stippleTexture()
  const ox = ((v.originX % STIPPLE_PX) + STIPPLE_PX) % STIPPLE_PX
  const oy = ((v.originY % STIPPLE_PX) + STIPPLE_PX) % STIPPLE_PX
  for (const r of rects) {
    const x0 = Math.max(0, tileEdgeX(v, r.x))
    const y0 = Math.max(0, tileEdgeY(v, r.y))
    const x1 = Math.min(v.w, tileEdgeX(v, r.x + r.w))
    const y1 = Math.min(v.h, tileEdgeY(v, r.y + r.h))
    if (x1 <= x0 || y1 <= y0) continue
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.clip()
    const sx = x0 - ((((x0 - ox) % STIPPLE_PX) + STIPPLE_PX) % STIPPLE_PX)
    const sy = y0 - ((((y0 - oy) % STIPPLE_PX) + STIPPLE_PX) % STIPPLE_PX)
    for (let y = sy; y < y1; y += STIPPLE_PX) for (let x = sx; x < x1; x += STIPPLE_PX) ctx.drawImage(tex, x, y)
    ctx.restore()
  }
}
