/**
 * The ghost pacer: a ghost that walks the route at a steady, brisk pace so the player has something to
 * chase. Pure: the clock comes in as an argument, so a test can run a quest in a loop.
 */

/** Brisk-walk default, km/h (about 110 steps a minute at a 0.75 m stride). */
export const DEFAULT_PACE_KMH = 5
export const MIN_PACE_KMH = 3
export const MAX_PACE_KMH = 7
/** The ghost is drawn this far ahead of the exact pace point, so it never hides under the hero. */
export const GHOST_LEAD_M = 6
/** The status stays quiet this long after the start (the ghost needs a moment to get ahead). */
export const WARMUP_MS = 15_000
/** Status thresholds, metres of gap between the hero and the pace point. */
export const ENTER_M = 30
export const EXIT_M = 12

export type Pace = { kmh: number; mps: number; stepsPerMin: number }

/**
 * The target pace. Without a suggested duration it is a brisk walk; with one (`durationMin`) it is the route
 * length over that time, kept between a stroll and a fast walk.
 */
export function paceFor(strideM: number, opts: { distanceM?: number; durationMin?: number } = {}): Pace {
  let kmh = DEFAULT_PACE_KMH
  if (opts.durationMin && opts.durationMin > 0 && opts.distanceM && opts.distanceM > 0) {
    kmh = opts.distanceM / 1000 / (opts.durationMin / 60)
  }
  kmh = Math.min(MAX_PACE_KMH, Math.max(MIN_PACE_KMH, Number.isFinite(kmh) ? kmh : DEFAULT_PACE_KMH))
  const mps = kmh / 3.6
  const stride = strideM > 0 ? strideM : 0.75
  return { kmh, mps, stepsPerMin: (mps * 60) / stride }
}

/**
 * The pacer clock and route frame. `elapsed` runs at `rate` (the simulator's time scale; 1 for real
 * walks) from `anchorMs`, frozen while `pausedAt` is set. `offsetM` turns pace distance into route
 * progress of the current route (it changes when the rest of the route is recalculated).
 */
export type PacerPlan = {
  paceMps: number
  rate: number
  /** Frame-clock time of the anchor. */
  anchorMs: number
  /** Elapsed quest time at the anchor, ms. */
  anchorElapsedMs: number
  pausedAt: number | undefined
  offsetM: number
  /**
   * Scripted extra gap, metres, as a function of elapsed quest time (ms): positive puts the pace point behind the
   * hero. Only the self-playing demo sets it (see `demo/script.ts`); a real walk has none.
   */
  gapScript?: (elapsedMs: number) => number
}

/** A pacer that starts now; a resumed quest starts with the ghost where the hero is (`alongM`). */
export function startPacer(now: number, pace: Pace, opts: { rate?: number; alongM?: number } = {}): PacerPlan {
  return { paceMps: pace.mps, rate: opts.rate ?? 1, anchorMs: now, anchorElapsedMs: ((opts.alongM ?? 0) / pace.mps) * 1000, pausedAt: undefined, offsetM: 0 }
}

/** Elapsed quest time, ms, excluding paused time. */
export function pacerElapsedMs(plan: PacerPlan, now: number): number {
  const end = plan.pausedAt ?? now
  return plan.anchorElapsedMs + Math.max(0, end - plan.anchorMs) * plan.rate
}

export function pausePacer(plan: PacerPlan, now: number): PacerPlan {
  return plan.pausedAt === undefined ? { ...plan, pausedAt: now } : plan
}

export function resumePacer(plan: PacerPlan, now: number): PacerPlan {
  if (plan.pausedAt === undefined) return plan
  return { ...plan, anchorMs: now, anchorElapsedMs: pacerElapsedMs(plan, now), pausedAt: undefined }
}

/** targetDistance(t) = pace × elapsed time, metres from the start of the quest. */
export function pacerDistanceM(plan: PacerPlan, now: number): number {
  const elapsed = pacerElapsedMs(plan, now)
  return (plan.paceMps * elapsed) / 1000 - (plan.gapScript?.(elapsed) ?? 0)
}

/** The pace point on the current route, metres along it (not below 0, not past the end). */
export function pacerAlongM(plan: PacerPlan, now: number, routeM: number): number {
  return Math.min(routeM, Math.max(0, pacerDistanceM(plan, now) - plan.offsetM))
}

/** Where the ghost is drawn: a little ahead of the pace point, never past the finish. */
export function ghostAlongM(plan: PacerPlan, now: number, routeM: number): number {
  return Math.min(routeM, pacerAlongM(plan, now, routeM) + GHOST_LEAD_M)
}

/** The route changed (a reroute): keep the gap between the hero and the pace point as it was. */
export function rebasePacer(plan: PacerPlan, heroAlongBefore: number, heroAlongAfter: number): PacerPlan {
  return { ...plan, offsetM: plan.offsetM + heroAlongBefore - heroAlongAfter }
}

export type PacerStatus = 'warmup' | 'ahead' | 'on' | 'behind'

/**
 * Status from the gap (hero progress minus pace point, metres) with hysteresis: it changes to ahead or
 * behind at ±`ENTER_M` and goes back to "on pace" only inside ±`EXIT_M`, so GPS noise does not flicker it.
 */
export function nextPacerStatus(prev: PacerStatus, gapM: number, elapsedMs: number): PacerStatus {
  if (elapsedMs < WARMUP_MS) return 'warmup'
  if (gapM >= ENTER_M) return 'ahead'
  if (gapM <= -ENTER_M) return 'behind'
  if (prev === 'ahead') return gapM > EXIT_M ? 'ahead' : 'on'
  if (prev === 'behind') return gapM < -EXIT_M ? 'behind' : 'on'
  return 'on'
}

/** Gap between the hero and the pace point, metres along the current route (positive = hero ahead). */
export function pacerGapM(plan: PacerPlan, now: number, heroAlongM: number): number {
  return heroAlongM - (pacerDistanceM(plan, now) - plan.offsetM)
}
