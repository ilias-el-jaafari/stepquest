/**
 * Avoided streets are drawn as 8-bit hazard tape: a dark band with amber
 * dashes, stamped one art pixel at a time so it stays crisp at every zoom.
 */

export type Stamp = { x: number; y: number; on: boolean }

/**
 * Square stamps along a polyline (screen px), one every `unit` px, alternating
 * dash on/off every `dash` px of travel. Distance carries over between
 * segments so the pattern runs continuously around corners. Pure.
 */
export function hazardStamps(points: readonly { x: number; y: number }[], unit: number, dash: number): Stamp[] {
  const out: Stamp[] = []
  if (points.length === 0 || unit <= 0 || dash <= 0) return out
  let travelled = 0
  const push = (x: number, y: number) => out.push({ x: Math.round(x / unit) * unit, y: Math.round(y / unit) * unit, on: Math.floor(travelled / dash) % 2 === 0 })
  push(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(len / unit))
    for (let k = 1; k <= steps; k++) {
      travelled += len / steps
      push(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps)
    }
  }
  return out
}

/** The point halfway along a polyline (by length), for the "no entry" sign. */
export function midpoint<T extends { x: number; y: number }>(points: readonly T[]): { x: number; y: number } | undefined {
  if (points.length === 0) return undefined
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= len && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len }
    left -= len
  }
  return { x: points[0]!.x, y: points[0]!.y }
}

/** 9×9 "no entry" sign: red disc, white bar, dark outline (original pixel art). */
export const NO_ENTRY: readonly string[] = [
  '..kkkkk..',
  '.krrrrrk.',
  'krrrrrrrk',
  'krrrrrrrk',
  'kwwwwwwwk',
  'krrrrrrrk',
  'krrrrrrrk',
  '.krrrrrk.',
  '..kkkkk..',
]
