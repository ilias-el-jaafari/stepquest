import { haversine, type LatLon } from '../geo/geo.ts'
import { bearingBetween } from '../routing/planner.ts'
import { effectiveAccuracy } from './gpsFilter.ts'
import { DEFAULT_QUEST_CONFIG, type OffStart, type QuestConfig } from './state.ts'

/** Smallest angle between two bearings, degrees (0–180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180)
  return d
}

/**
 * Off the line: still heading for the next checkpoint (reroute quietly), walking
 * clearly away (show the message), or not sure yet (keep watching). GPS noise is
 * absorbed by requiring real walked distance (the odometer ignores jitter).
 */
export function judgeDeviation(off: OffStart, position: LatLon, odoM: number, goal: LatLon, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): 'wait' | 'toward' | 'away' {
  const walked = odoM - off.odoM
  if (walked < cfg.decideM) return 'wait'
  const goalNow = haversine(position, goal)
  const heading = angleDiff(bearingBetween(off.point, position), bearingBetween(off.point, goal))
  const closer = goalNow <= off.goalM + cfg.goalSlackM
  if (heading <= cfg.towardDeg || closer) return 'toward'
  return walked >= cfg.lostM ? 'away' : 'wait'
}

export function offRouteThreshold(accuracyM: number, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): number {
  return Math.max(cfg.offRouteM, effectiveAccuracy(accuracyM) * 1.5)
}

/**
 * On the route? With hysteresis: a walker who is already off the line (`wasOff`) has to
 * come within `returnFactor` of the threshold, so one noisy fix does not end a deviation.
 */
export function isOnRoute(offsetM: number, thresholdM: number, wasOff: boolean, returnFactor = DEFAULT_QUEST_CONFIG.returnFactor): boolean {
  return offsetM <= (wasOff ? thresholdM * returnFactor : thresholdM)
}

