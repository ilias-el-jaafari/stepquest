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
  /** Fixes this far behind the last accepted one count as "the clock was set back" (not a duplicate). */
  clockBackMs: number
  /** How many such fixes in a row make the filter continue from the new clock. */
  clockBackFixes: number
}

export const DEFAULT_FILTER: FilterConfig = {
  maxAccuracyM: 50,
  maxSpeedMps: 7,
  resetAfterRejects: 3,
  processNoise: 2,
  clockBackMs: 30_000,
  clockBackFixes: 3,
}

/** Accuracy assumed for a fix that reports none (0, negative, NaN, missing), metres. */
export const UNKNOWN_ACCURACY_M = 20

/** The accuracy to use for a reading: as reported, or 20 m when the device gives no usable number. */
export function effectiveAccuracy(reported: number | undefined): number {
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : UNKNOWN_ACCURACY_M
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
  /** Accuracy of that raw fix (the speed check allows for both readings). */
  rawAccuracy?: number
  /** Consecutive too-fast fixes that agree with one another. */
  rejects: number
  /** The latest too-fast fix: the next outlier must agree with it to count. */
  outlier?: { lat: number; lon: number; timestamp: number }
  /** Consecutive fixes more than `clockBackMs` behind the last accepted one. */
  clockBack?: number
}

export type RejectReason = 'invalid' | 'inaccurate' | 'stale' | 'tooFast'

export type FilterResult =
  /** `jumped`: accepted after agreeing outliers; the position moved further than walking allows. */
  | { accepted: true; state: FilterState; position: LatLon; accuracy: number; jumped?: boolean }
  | { accepted: false; state: FilterState | undefined; reason: RejectReason }

function fresh(fix: GpsFix, accuracy: number): FilterState {
  return { lat: fix.lat, lon: fix.lon, variance: accuracy * accuracy, timestamp: fix.timestamp, rawLat: fix.lat, rawLon: fix.lon, rawAccuracy: accuracy, rejects: 0 }
}

/**
 * Accuracy gate + max-speed sanity check + a 1-D (isotropic) Kalman smoother.
 * Pure: give it the previous state and a fix, get the next state back.
 *
 * - Coordinates or timestamp that are not finite numbers in range: `invalid`.
 * - Accuracy that is 0, negative, NaN or missing counts as 20 m (`effectiveAccuracy`).
 * - A timestamp not later than the last accepted fix: `stale` (duplicate, out of order). When
 *   `clockBackFixes` fixes in a row are more than `clockBackMs` behind, the device clock was set
 *   back and the filter continues from the new clock (as if one second after the last fix).
 * - A jump faster than `maxSpeedMps` (plus the accuracy of both readings): `tooFast`. The walker
 *   is moved only after `resetAfterRejects` such fixes in a row that agree with one another.
 */
export function filterFix(prev: FilterState | undefined, fix: GpsFix, cfg: FilterConfig = DEFAULT_FILTER): FilterResult {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180 || !Number.isFinite(fix.timestamp)) {
    return { accepted: false, state: prev, reason: 'invalid' }
  }
  const accuracy = effectiveAccuracy(fix.accuracy)
  if (accuracy > cfg.maxAccuracyM) return { accepted: false, state: prev, reason: 'inaccurate' }
  const measVar = accuracy * accuracy

  if (!prev) {
    return { accepted: true, state: fresh(fix, accuracy), position: { lat: fix.lat, lon: fix.lon }, accuracy }
  }
  let last = prev
  if (fix.timestamp <= prev.timestamp) {
    const behind = prev.timestamp - fix.timestamp > cfg.clockBackMs
    const run = behind ? (prev.clockBack ?? 0) + 1 : 0
    if (run < cfg.clockBackFixes) return { accepted: false, state: { ...prev, clockBack: run || undefined }, reason: 'stale' }
    // The clock was set back: carry on from the new time.
    last = { ...prev, timestamp: fix.timestamp - 1000, clockBack: undefined }
  }

  const dt = (fix.timestamp - last.timestamp) / 1000
  const jump = haversine({ lat: last.rawLat, lon: last.rawLon }, fix)
  // Allow for the accuracy of both readings before calling it a glitch.
  const plausible = cfg.maxSpeedMps * dt + accuracy + (last.rawAccuracy ?? 0)
  if (jump > plausible) {
    // Does this outlier agree with the previous one (could the walker have gone from there to here)?
    const o = last.outlier
    const agrees = !!o && haversine(o, fix) <= cfg.maxSpeedMps * Math.max(0, (fix.timestamp - o.timestamp) / 1000) + accuracy
    const rejects = agrees ? last.rejects + 1 : 1
    if (rejects < cfg.resetAfterRejects) {
      return { accepted: false, state: { ...last, rejects, outlier: { lat: fix.lat, lon: fix.lon, timestamp: fix.timestamp } }, reason: 'tooFast' }
    }
    // Several glitches in a row agree: the walker really is over there.
    return { accepted: true, state: fresh(fix, accuracy), position: { lat: fix.lat, lon: fix.lon }, accuracy, jumped: true }
  }

  const predicted = last.variance + cfg.processNoise * dt
  const gain = predicted / (predicted + measVar)
  const lat = last.lat + gain * (fix.lat - last.lat)
  const lon = last.lon + gain * (fix.lon - last.lon)
  const variance = (1 - gain) * predicted
  const state: FilterState = { lat, lon, variance, timestamp: fix.timestamp, rawLat: fix.lat, rawLon: fix.lon, rawAccuracy: accuracy, rejects: 0 }
  return { accepted: true, state, position: { lat, lon }, accuracy: Math.sqrt(variance) }
}

/**
 * Odometer that ignores jitter: distance is only added once the smoothed
 * position has moved further than `ODO_NOISE_FACTOR` × the reported accuracy
 * (4 to 30 m) from the last anchor. A standing walker with realistic noise adds
 * nothing (see the design notes for the measurements); the last, incomplete
 * stretch of a walk is not counted until it is. The total never decreases.
 */
export type Odometer = { anchor: LatLon | undefined; totalM: number }

export const ODO_NOISE_FACTOR = 2
export const ODO_MIN_STEP_M = 4
export const ODO_MAX_STEP_M = 30

/**
 * `accuracyM`: the reported accuracy of the fix (not the smoothed one).
 * `maxAddM`: the most one move may add (for a position accepted after a jump).
 */
export function advanceOdometer(odo: Odometer, position: LatLon, accuracyM: number, maxAddM = Infinity): Odometer {
  if (!odo.anchor) return { anchor: position, totalM: odo.totalM }
  const d = haversine(odo.anchor, position)
  const threshold = Math.max(ODO_MIN_STEP_M, Math.min(ODO_MAX_STEP_M, effectiveAccuracy(accuracyM) * ODO_NOISE_FACTOR))
  if (!(d >= threshold)) return odo
  return { anchor: position, totalM: odo.totalM + Math.max(0, Math.min(d, maxAddM)) }
}
