import type { LatLon } from '../geo/geo.ts'
import type { Checkpoint } from './checkpoints.ts'

/** Public request/response types of the route planners (re-exported by `planner.ts`). */

export type RouteMode = 'loop' | 'oneway'

export type RouteRequest = {
  mode: RouteMode
  start: LatLon
  /** Required for one-way routes. */
  end?: LatLon
  targetSteps: number
  strideM: number
  /** Checkpoints to place; defaults to one per ~1,000 steps. */
  checkpoints?: number
  /** Changes the loop's direction so "Reroll" gives a different walk. */
  seed?: number
  /** Per-edge cost multipliers (safety weights; Infinity = never use). Lengths stay real. */
  cost?: Float32Array
  /** Smallest value in `cost` (keeps A* exact when some streets are preferred). */
  minCost?: number
}

export type Route = {
  mode: RouteMode
  points: LatLon[]
  nodes: number[]
  distanceM: number
  steps: number
  targetSteps: number
  targetM: number
  /** Signed error versus the target, as a fraction (0.03 = 3 % long). */
  error: number
  /** Fraction of the distance walked twice (out-and-back sections). */
  overlap: number
  checkpoints: Checkpoint[]
  withinTolerance: boolean
}

/**
 * Why no route was returned.
 * - `outOfRange`: the goal is outside [MIN_STEPS, MAX_STEPS]; `minSteps`/`maxSteps` are those bounds.
 * - `tooShort` / `tooLong`: the goal is below the shortest or above the longest route that fits here.
 * - `noMatch`: routes exist but none landed within ±5 % (the closest is attached).
 */
export type InfeasibleReason = 'outOfRange' | 'tooShort' | 'tooLong' | 'noMatch' | 'outsideArea' | 'unreachable' | 'samePoint'

export type PlanResult =
  | { ok: true; route: Route }
  | {
      ok: false
      reason: InfeasibleReason
      /** Fewest steps that can work (the direct A→B distance, or the shortest loop found). */
      minSteps?: number
      /** Most steps we could reach inside the loaded area. */
      maxSteps?: number
      /** Closest attempt, shown as a preview when there is one. */
      closest?: Route
    }
