/**
 * Above-ground tram, metro and train tracks, drawn as 8-bit rails: a gravel
 * bed, wooden sleepers across the line and two steel rails, stamped one art
 * pixel at a time so they stay crisp and clearly not a street at every zoom.
 */

export type RailStamp = { x: number; y: number; nx: number; ny: number; sleeper: boolean }

/**
 * Stamps along a screen polyline, one every `unit` px, with the unit normal of
 * the current segment and a sleeper every `gap` px of travel. Pure.
 */
export function railStamps(points: readonly { x: number; y: number }[], unit: number, gap: number): RailStamp[] {
  const out: RailStamp[] = []
  if (points.length < 2 || unit <= 0 || gap <= 0) return out
  let travelled = 0
  let nextSleeper = gap / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const steps = Math.max(1, Math.ceil(len / unit))
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const d = travelled + (len * k) / steps
      const sleeper = d >= nextSleeper
      if (sleeper) nextSleeper += gap
      out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps, nx, ny, sleeper })
    }
    travelled += len
  }
  return out
}
