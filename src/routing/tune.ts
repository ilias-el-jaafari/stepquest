import { CLEAN_OVERLAP, score } from './routeBuild.ts'
import type { Route } from './planTypes.ts'

/** Search helpers shared by the loop and A→B planners. */

/** Deterministic pseudo-random in [0,1) from a seed. */
export function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Smallest size (metres) `tune` will try. */
export const MIN_TUNE_SIZE_M = 20
/** Iterations per `tune` call; the search is a damped secant, so it converges in a handful. */
export const TUNE_ITERATIONS = 7

/**
 * Tune one scalar size (a radius or an offset) so the routed length matches
 * the target. Lengths grow roughly linearly with size, so a damped secant
 * step converges in a handful of iterations. Always terminates after
 * `iterations` builds.
 */
export function tune(
  build: (size: number) => Route | undefined,
  targetM: number,
  initial: number,
  maxSize: number,
  iterations = TUNE_ITERATIONS,
): Route | undefined {
  let size = initial
  let best: Route | undefined
  for (let i = 0; i < iterations; i++) {
    const route = build(size)
    if (!route) {
      size *= 0.8
      continue
    }
    if (!best || score(route) < score(best)) best = route
    if (route.withinTolerance && Math.abs(route.error) < 0.03 && route.overlap < CLEAN_OVERLAP) break
    const ratio = targetM / Math.max(1, route.distanceM)
    size = Math.min(maxSize, Math.max(MIN_TUNE_SIZE_M, size * (1 + (ratio - 1) * 0.9)))
  }
  return best
}

/** Remembers the shortest and the longest route a planner built, for "too short / too long" hints. */
export class Attempts {
  shortest: Route | undefined
  longest: Route | undefined

  /** Record a route (or nothing) and hand it back, so it can wrap a `build` result. */
  track(route: Route | undefined): Route | undefined {
    if (!route) return route
    if (!this.shortest || route.distanceM < this.shortest.distanceM) this.shortest = route
    if (!this.longest || route.distanceM > this.longest.distanceM) this.longest = route
    return route
  }
}
