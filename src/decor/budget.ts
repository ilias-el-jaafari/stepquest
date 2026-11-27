import { DETAIL_ZOOM } from '../render/camera.ts'

/**
 * How much decor to show (halloween-decor spec, H4 to H8): by zoom, time of day and motion setting.
 * Pure. Placement (`place.ts`) lists a chunk's items in rank order; these numbers say how many to show.
 */

/** Decor is hidden below this zoom (CSS px per tile): the map is the 1-px-per-tile overview there. */
export const MIN_DECOR_ZOOM = DETAIL_ZOOM
/** Most animated items drawn in one frame, and the rate their motion steps at. */
export const MAX_ANIMATED = 12
export const ANIM_HZ = 12
export const ANIM_FRAME_MS = 1000 / ANIM_HZ
/** Darkness (0 to 1, from the day cycle) from which the scene counts as night for decor. */
export const NIGHT_DARKNESS = 0.3
/** Share of the items (by rank) that is shown by day; at night all of them. */
export const DAY_DENSITY = 0.8
/** The most static items a screen of the usual phone size shows at any zoom; a test holds the numbers to it. */
export const MAX_STATIC_PER_SCREEN = 48

export type DecorBudget = {
  visible: boolean
  night: boolean
  /** Static items drawn per 32-tile chunk (by rank). */
  staticPerChunk: number
  /** Animated items per chunk; the frame cap `MAX_ANIMATED` applies on top. */
  animPerChunk: number
  /** Items with a rank below this are shown. */
  density: number
}

/**
 * A 32-tile chunk is a big part of a phone screen at low zoom and a small one at high zoom (about 1.3 chunks
 * at 16 px per tile, 0.3 at 32), so the cap per chunk grows with the zoom to keep a screen at roughly 3 to 8
 * items by day and at most `MAX_STATIC_PER_SCREEN` at night.
 */
const STATIC_BY_ZOOM: readonly (readonly [number, number])[] = [
  [8, 2],
  [12, 5],
  [16, 10],
  [24, 24],
  [32, 40],
  [48, 70],
]

/** Piecewise-linear table lookup, rounded, clamped at both ends. */
function lookup(table: readonly (readonly [number, number])[], zoom: number): number {
  const first = table[0]!
  if (zoom <= first[0]) return first[1]
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i]!
    if (zoom <= z1) {
      const [z0, v0] = table[i - 1]!
      return Math.round(v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0))
    }
  }
  return table[table.length - 1]![1]
}

export function isNight(darkness: number): boolean {
  return darkness >= NIGHT_DARKNESS
}

export function decorBudget(zoom: number, darkness: number, enabled = true): DecorBudget {
  const night = isNight(darkness)
  if (!enabled || zoom < MIN_DECOR_ZOOM) return { visible: false, night, staticPerChunk: 0, animPerChunk: 0, density: 0 }
  return {
    visible: true,
    night,
    staticPerChunk: lookup(STATIC_BY_ZOOM, zoom),
    animPerChunk: night ? (zoom < 12 ? 1 : zoom < 24 ? 2 : 3) : 1,
    density: night ? 1 : DAY_DENSITY,
  }
}

/** Sprite size on screen: device px per art pixel for a view scale (device px per tile), at least 1 once drawn. */
export function artPx(scale: number): number {
  return scale / 16
}
