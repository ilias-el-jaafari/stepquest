import type { House, Landmark } from '../town/layout.ts'
import { P } from './palette.ts'
import { paintHouse, paintLandmark } from './structures.ts'

/**
 * Night lights: lit windows found by running the real painters against a
 * recording context (so the glow always sits exactly on the painted glass),
 * and pixel-art glow sprites. Everything is deterministic per building.
 */

export type WindowRect = { x: number; y: number; w: number; h: number }

const GLASS = new Set<string>([P.window, P.glass])

function record(paint: (ctx: never) => void): WindowRect[] {
  const found: WindowRect[] = []
  const ctx = {
    fillStyle: '' as string,
    fillRect(x: number, y: number, w: number, h: number) {
      if (typeof ctx.fillStyle === 'string' && GLASS.has(ctx.fillStyle) && w >= 3 && h >= 2) found.push({ x, y, w, h })
    },
  }
  paint(ctx as never)
  return found
}

const houseCache = new WeakMap<House, WindowRect[]>()
const landmarkCache = new WeakMap<Landmark, WindowRect[]>()

/** Window glass rectangles of a house relative to its top-left pixel, ~70 % of them lit (stable per building). */
export function litHouseWindows(house: House): WindowRect[] {
  let w = houseCache.get(house)
  if (!w) {
    w = pickLit(record((ctx) => paintHouse(ctx, 0, 0, house)), house.seed ^ (house.x * 73856093) ^ (house.y * 19349663))
    houseCache.set(house, w)
  }
  return w
}

export function litLandmarkWindows(lm: Landmark): WindowRect[] {
  let w = landmarkCache.get(lm)
  if (!w) {
    w = pickLit(record((ctx) => paintLandmark(ctx, 0, 0, lm)), (lm.x * 73856093) ^ (lm.y * 19349663))
    landmarkCache.set(lm, w)
  }
  return w
}

/** Keep about 70 % of the windows, chosen from a hash of the building and the window position. */
function pickLit(all: WindowRect[], seed: number): WindowRect[] {
  return all.filter((r) => {
    let h = (seed ^ Math.imul(r.x, 2654435761) ^ Math.imul(r.y + 1, 40503)) >>> 0
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = (h ^ (h >>> 13)) >>> 0
    return h % 100 < 70
  })
}

/**
 * A round glow in stepped, dithered pixel rings (art pixels; scale it up with
 * smoothing off). `rgb` is the light colour; alpha falls off in four bands.
 */
export function paintGlow(ctx: CanvasRenderingContext2D, size: number, rgb: readonly [number, number, number]): void {
  const c = (size - 1) / 2
  const bands = [0.5, 0.33, 0.19, 0.09]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2)
      if (d >= 1) continue
      const band = Math.min(bands.length - 1, Math.floor(d * bands.length))
      const edge = d * bands.length - band
      // Dither the outer part of each band into the next one.
      const dim = edge > 0.6 && (x + y) % 2 === 0 && band + 1 < bands.length
      const alpha = bands[dim ? band + 1 : band]!
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

export const LAMP_RGB = [255, 190, 90] as const
export const WALKER_RGB = [255, 236, 170] as const
export const WINDOW_RGB = '#ffd36b'
