import { haversine, type LatLon } from '../geo/geo.ts'

export type Checkpoint = {
  /** 1-based order along the route. */
  index: number
  point: LatLon
  /** Distance from the start, in metres. */
  distanceM: number
  isFinish: boolean
}

export const STEPS_PER_CHECKPOINT = 1000
export const MAX_CHECKPOINTS = 30

export function cumulativeDistances(points: LatLon[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + haversine(points[i - 1]!, points[i]!))
  return out
}

/** Point at `distance` metres along a polyline (clamped to its ends). */
export function pointAlong(points: LatLon[], cumulative: number[], distance: number): LatLon {
  if (points.length === 0) throw new Error('empty polyline')
  if (distance <= 0) return points[0]!
  const total = cumulative[cumulative.length - 1] ?? 0
  if (distance >= total) return points[points.length - 1]!
  let lo = 0
  let hi = cumulative.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid]! <= distance) lo = mid
    else hi = mid
  }
  const a = points[lo]!
  const b = points[hi]!
  const seg = cumulative[hi]! - cumulative[lo]!
  const t = seg === 0 ? 0 : (distance - cumulative[lo]!) / seg
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
}

/** Default count: one checkpoint per ~1,000 steps, at least one (the finish). */
export function defaultCheckpointCount(steps: number): number {
  return Math.max(1, Math.min(MAX_CHECKPOINTS, Math.round(steps / STEPS_PER_CHECKPOINT)))
}

/**
 * Evenly spaced checkpoints: checkpoint k sits at k/N of the route, so the
 * last one is the finish line and every gap is the same length.
 */
export function placeCheckpoints(points: LatLon[], count: number): Checkpoint[] {
  if (points.length < 2) return []
  const n = Math.max(1, Math.min(MAX_CHECKPOINTS, Math.round(count)))
  const cumulative = cumulativeDistances(points)
  const total = cumulative[cumulative.length - 1]!
  const out: Checkpoint[] = []
  for (let k = 1; k <= n; k++) {
    const distanceM = (total * k) / n
    out.push({ index: k, point: pointAlong(points, cumulative, distanceM), distanceM, isFinish: k === n })
  }
  return out
}
