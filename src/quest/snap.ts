import { LocalProjection, type LatLon } from '../geo/geo.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'

/** Precomputed route geometry for fast snapping. */
export type RouteTrack = {
  points: LatLon[]
  cumulative: number[]
  total: number
  projection: LocalProjection
  xy: { x: number; y: number }[]
}

export function makeTrack(points: LatLon[]): RouteTrack {
  const projection = new LocalProjection(points[0] ?? { lat: 0, lon: 0 })
  const cumulative = cumulativeDistances(points)
  return {
    points,
    cumulative,
    total: cumulative[cumulative.length - 1] ?? 0,
    projection,
    xy: points.map((p) => projection.toXY(p)),
  }
}

export type Snap = {
  /** Closest point on the route. */
  point: LatLon
  /** Distance along the route to that point, metres. */
  alongM: number
  /** Distance from the position to the route, metres. */
  offsetM: number
}

/**
 * Snap a position to the route. With `nearAlongM`, only segments within a
 * window around the walker's last progress are considered first, so a loop
 * that crosses itself does not make the walker jump to the other pass.
 */
export function snapToRoute(track: RouteTrack, p: LatLon, nearAlongM?: number, behindM = 60, aheadM = 400): Snap {
  const windowed = nearAlongM === undefined ? undefined : bestSnap(track, p, nearAlongM - behindM, nearAlongM + aheadM)
  if (windowed && windowed.offsetM <= 60) return windowed
  const global = bestSnap(track, p, -Infinity, Infinity)!
  if (!windowed) return global
  // Prefer the windowed answer unless the global one is much closer.
  return global.offsetM + 25 < windowed.offsetM ? global : windowed
}

function bestSnap(track: RouteTrack, p: LatLon, fromM: number, toM: number): Snap | undefined {
  const { x: px, y: py } = track.projection.toXY(p)
  let best: Snap | undefined
  let bestD = Infinity
  for (let i = 1; i < track.xy.length; i++) {
    const c0 = track.cumulative[i - 1]!
    const c1 = track.cumulative[i]!
    if (c1 < fromM || c0 > toM) continue
    const a = track.xy[i - 1]!
    const b = track.xy[i]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    let t = len2 === 0 ? 0 : ((px - a.x) * vx + (py - a.y) * vy) / len2
    t = Math.max(0, Math.min(1, t))
    const sx = a.x + t * vx
    const sy = a.y + t * vy
    const d = Math.hypot(px - sx, py - sy)
    if (d < bestD) {
      bestD = d
      best = { point: track.projection.toLatLon(sx, sy), alongM: c0 + t * (c1 - c0), offsetM: d }
    }
  }
  if (!best && track.points.length === 1) {
    const only = track.points[0]!
    const { x, y } = track.xy[0]!
    return { point: only, alongM: 0, offsetM: Math.hypot(px - x, py - y) }
  }
  return best
}
