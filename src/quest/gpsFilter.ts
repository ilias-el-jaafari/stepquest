import { haversine, type LatLon } from '../geo/geo.ts'
import type { GpsFix } from './types.ts'

export type FilterConfig = {
  /** Fixes less accurate than this are ignored (but reported as "weak signal"). */
  maxAccuracyM: number
  /** Faster than this between two fixes is treated as a glitch (brisk running is ~5 m/s). */
  maxSpeedMps: number
  /** After this many rejected "too fast" fixes in a row, trust the new position (e.g. after a tunnel). */
  resetAfterRejects: number
  /** Process noise for the smoother, in m²/s: how quickly a walker can change course. */
  processNoise: number
}

export const DEFAULT_FILTER: FilterConfig = {
  maxAccuracyM: 50,
  maxSpeedMps: 7,
  resetAfterRejects: 3,
  processNoise: 2,
}

export type FilterState = {
  /** Smoothed position. */
  lat: number
  lon: number
  /** Variance of the smoothed position, m². */
  variance: number
  timestamp: number
  /** Last raw fix we accepted (speed checks compare against it). */
  rawLat: number
  rawLon: number
  rejects: number
}

export type RejectReason = 'inaccurate' | 'stale' | 'tooFast'

export type FilterResult =
  | { accepted: true; state: FilterState; position: LatLon; accuracy: number }
  | { accepted: false; state: FilterState | undefined; reason: RejectReason }

/**
 * Accuracy gate + max-speed sanity check + a 1-D (isotropic) Kalman smoother.
 * Pure: give it the previous state and a fix, get the next state back.
 */
export function filterFix(prev: FilterState | undefined, fix: GpsFix, cfg: FilterConfig = DEFAULT_FILTER): FilterResult {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !(fix.accuracy > 0)) {
    return { accepted: false, state: prev, reason: 'inaccurate' }
  }
  if (fix.accuracy > cfg.maxAccuracyM) return { accepted: false, state: prev, reason: 'inaccurate' }
  const measVar = fix.accuracy * fix.accuracy

  if (!prev) {
    const state: FilterState = { lat: fix.lat, lon: fix.lon, variance: measVar, timestamp: fix.timestamp, rawLat: fix.lat, rawLon: fix.lon, rejects: 0 }
    return { accepted: true, state, position: { lat: fix.lat, lon: fix.lon }, accuracy: fix.accuracy }
  }
  if (fix.timestamp <= prev.timestamp) return { accepted: false, state: prev, reason: 'stale' }

  const dt = (fix.timestamp - prev.timestamp) / 1000
  const jump = haversine({ lat: prev.rawLat, lon: prev.rawLon }, fix)
  // Allow for the accuracy of both readings before calling it a glitch.
  const plausible = cfg.maxSpeedMps * dt + fix.accuracy
  if (jump > plausible) {
    if (prev.rejects + 1 < cfg.resetAfterRejects) {
      return { accepted: false, state: { ...prev, rejects: prev.rejects + 1 }, reason: 'tooFast' }
    }
    // Several glitches in a row agree: the walker really is over there.
    const state: FilterState = { lat: fix.lat, lon: fix.lon, variance: measVar, timestamp: fix.timestamp, rawLat: fix.lat, rawLon: fix.lon, rejects: 0 }
    return { accepted: true, state, position: { lat: fix.lat, lon: fix.lon }, accuracy: fix.accuracy }
  }

  const predicted = prev.variance + cfg.processNoise * dt
  const gain = predicted / (predicted + measVar)
  const lat = prev.lat + gain * (fix.lat - prev.lat)
  const lon = prev.lon + gain * (fix.lon - prev.lon)
  const variance = (1 - gain) * predicted
  const state: FilterState = { lat, lon, variance, timestamp: fix.timestamp, rawLat: fix.lat, rawLon: fix.lon, rejects: 0 }
  return { accepted: true, state, position: { lat, lon }, accuracy: Math.sqrt(variance) }
}

/**
 * Odometer that ignores jitter: distance is only added once the smoothed
 * position has moved further than `minStepM` from the last anchor.
 */
export type Odometer = { anchor: LatLon | undefined; totalM: number }

export function advanceOdometer(odo: Odometer, position: LatLon, accuracy: number, minStepM = 4): Odometer {
  if (!odo.anchor) return { anchor: position, totalM: odo.totalM }
  const d = haversine(odo.anchor, position)
  const threshold = Math.max(minStepM, Math.min(15, accuracy * 0.5))
  if (d < threshold) return odo
  return { anchor: position, totalM: odo.totalM + d }
}
