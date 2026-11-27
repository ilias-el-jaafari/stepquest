import type { LatLon } from '../geo/geo.ts'
import { haversine } from '../geo/geo.ts'
import { effectiveAccuracy } from './gpsFilter.ts'
import { DEFAULT_QUEST_CONFIG, type QuestConfig, type QuestEvent } from './state.ts'
import type { QuestRoute } from './types.ts'

/** Pickup radius grows with poor accuracy (half of anything above 10 m), capped. */
export function collectRadius(accuracyM: number, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): number {
  const extra = Math.max(0, effectiveAccuracy(accuracyM) - 10) * 0.5
  return Math.min(cfg.maxRadiusM, cfg.baseRadiusM + extra)
}


/** The finish counts only after this share of the route has been walked (monotonic progress along the line). */
export const ARRIVAL_PROGRESS = 0.9
/** ... and after the odometer shows at least this share of the route length. */
export const ARRIVAL_MIN_WALKED = 0.5

/**
 * May this gem be collected yet? Progress along the route must have come close to the gem's place
 * (a gem that lies near the start in space, as in a loop, is not taken at the start), and the finish
 * also needs `ARRIVAL_PROGRESS` of the route and `ARRIVAL_MIN_WALKED` of its length on the odometer.
 * Without that, a loop (start = finish) would end at the first fix.
 */
export function canCollect(
  cp: { distanceM: number; isFinish: boolean },
  alongM: number,
  walkedM: number,
  routeM: number,
  radiusM: number,
): boolean {
  if (cp.isFinish) return alongM >= ARRIVAL_PROGRESS * routeM && walkedM >= ARRIVAL_MIN_WALKED * routeM
  return alongM >= cp.distanceM - Math.max(2 * radiusM, 40)
}

export type CollectInput = {
  route: QuestRoute
  /** Gems collected so far; the next one to collect is `checkpoints[collected]`. */
  collected: number
  /** Filtered position of this fix. */
  position: LatLon
  /** Distance along the route before and after this fix (progress only moves while on the route). */
  prevAlongM: number
  alongM: number
  /** Distance of the position from the route, and whether the walker counts as on it. */
  offsetM: number
  onRoute: boolean
  accuracyM: number
  /** Odometer reading, metres (default: not checked). */
  walkedM?: number
  /** Time since the previous fix (or since the quest started), seconds. */
  elapsedS: number
}

/**
 * Which gems does this fix collect? Strictly in route order and each at most once (the count only
 * goes up and the loop stops at the first gem that is neither reached nor passed). A gem is
 * reached when the position is inside the pickup radius. It is passed when the walker advanced
 * along the route across its place, close to the line, by no more than a walker could in the
 * time since the last fix (`max(maxPassJumpM, passSpeedMps × elapsed)`): a long gap with the
 * page in the background still counts, a jump in a second does not.
 */
export function collectCheckpoints(input: CollectInput, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): { collected: number; events: QuestEvent[] } {
  const cps = input.route.checkpoints
  const radius = collectRadius(input.accuracyM, cfg)
  const maxAdvance = Math.max(cfg.maxPassJumpM, cfg.passSpeedMps * Math.max(0, input.elapsedS))
  const events: QuestEvent[] = []
  let collected = input.collected
  while (collected < cps.length) {
    const cp = cps[collected]!
    if (!canCollect(cp, input.alongM, input.walkedM ?? Infinity, input.route.distanceM, radius)) break
    const near = haversine(input.position, cp.point) <= radius
    // Sparse fixes can skip over a checkpoint; walking past it along the route counts too.
    const passed =
      input.onRoute && input.offsetM <= radius && input.prevAlongM < cp.distanceM && input.alongM >= cp.distanceM && input.alongM - input.prevAlongM <= maxAdvance
    if (!near && !passed) break
    events.push({ type: 'collected', index: cp.index, isFinish: cp.isFinish, point: cp.point })
    collected++
  }
  return { collected, events }
}
