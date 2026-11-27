import type { DecorItem } from './place.ts'
import { ANIM_FRAME_MS } from './budget.ts'

/**
 * Motion of the animated decor (halloween-decor spec, H6). Pure functions of the item and a tick
 * (`tickOf(now)`, 12 per second), so the same tick always gives the same picture and nothing allocates.
 * With reduced motion the tick is 0 and every item rests at its anchor.
 */

export const tickOf = (now: number, reduced: boolean): number => (reduced ? 0 : Math.floor(now / ANIM_FRAME_MS))

const TAU = Math.PI * 2

/** Bat wing frame: the wings flap at 6 Hz (two ticks per frame). */
export const batFrame = (tick: number, item: DecorItem): number => (tick === 0 ? 0 : ((tick + Math.floor(item.phase * 4)) >> 1) & 1)

/** Orbit period of a bat in ticks (14 to 22 s: slow). */
const batPeriod = (item: DecorItem): number => (14 + item.phase * 8) * 12

/** Where a bat is, in tiles: a slow loop around its anchor, about 0.45 tile above its anchor, within 0.55 tile sideways (the 13-pixel bat then stays inside the street-free 3×3). */
export function batX(item: DecorItem, tick: number): number {
  return item.x + 0.55 * Math.cos(TAU * (tick / batPeriod(item) + item.phase))
}
export function batY(item: DecorItem, tick: number): number {
  return item.y - 0.45 + 0.2 * Math.sin(2 * TAU * (tick / batPeriod(item) + item.phase))
}

/** Fog drifts sideways by up to 0.3 tile and back (30 s), anchored at the item. */
export function fogX(item: DecorItem, tick: number): number {
  return item.x + 0.3 * Math.sin(TAU * (tick / (30 * 12) + item.phase))
}

/** A skeleton waves at 3 Hz (frame changes every four ticks). */
export const skeletonFrame = (tick: number): number => (tick >> 2) & 1

/** Candle and jack-o'-lantern flicker: 0.8 to 1, from a hash of the item and the tick (1 with reduced motion). */
export function flickerLevel(item: DecorItem, tick: number): number {
  if (tick === 0) return 1
  let h = (Math.imul(item.tx, 73856093) ^ Math.imul(item.ty, 19349663) ^ Math.imul(tick >> 1, 83492791)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  return 0.8 + 0.2 * ((h % 1000) / 999)
}
