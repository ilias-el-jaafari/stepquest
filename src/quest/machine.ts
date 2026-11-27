import { haversine } from '../geo/geo.ts'
import { collectCheckpoints } from './collect.ts'
import { isOnRoute, judgeDeviation, offRouteThreshold } from './deviation.ts'
import { advanceOdometer, effectiveAccuracy, filterFix } from './gpsFilter.ts'
import { snapToRoute } from './snap.ts'
import { DEFAULT_QUEST_CONFIG, trackFor, type OffStart, type QuestConfig, type QuestEvent, type QuestState } from './state.ts'
import type { GpsFix } from './types.ts'

/**
 * The quest state machine: feed one GPS fix, get the next state and what happened
 * (`collected`, `finished`, `rejected`, `offRoute`, `backOnRoute`, `reroute`).
 * Pure apart from a geometry cache: no clock, no storage, no React.
 *
 * Order of work for an accepted fix: filter (gate, speed, smoothing) → snap to the route →
 * off-route count with hysteresis → odometer → deviation verdict (quiet reroute or message)
 * → gem collection → finish. A finished quest ignores every later fix.
 */
export function applyFix(state: QuestState, fix: GpsFix, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): { state: QuestState; events: QuestEvent[] } {
  if (state.finishedAt !== undefined) return { state, events: [] }
  const events: QuestEvent[] = []
  const filtered = filterFix(state.filter, fix, cfg.filter)
  if (!filtered.accepted) {
    events.push({ type: 'rejected', reason: filtered.reason })
    return {
      state: {
        ...state,
        filter: filtered.state,
        weakSince: filtered.reason === 'inaccurate' ? (state.weakSince ?? fix.timestamp) : state.weakSince,
      },
      events,
    }
  }

  const { position } = filtered
  const reported = effectiveAccuracy(fix.accuracy)
  const track = trackFor(state.route)
  const snap = snapToRoute(track, position, state.alongM)
  const threshold = offRouteThreshold(reported, cfg)
  const onRoute = isOnRoute(snap.offsetM, threshold, state.offRouteCount > 0, cfg.returnFactor)
  const offRouteCount = onRoute ? 0 : state.offRouteCount + 1
  const offRoute = offRouteCount >= cfg.offRouteFixes
  const sinceLastS = (fix.timestamp - (state.lastFixAt ?? state.startedAt)) / 1000
  // A position accepted after agreeing outliers may add only what walking at the speed limit allows.
  const maxAddM = filtered.jumped ? cfg.filter.maxSpeedMps * Math.max(1, sinceLastS) + reported : Infinity
  const odometer = advanceOdometer(state.odometer, position, reported, maxAddM)
  const goal = state.route.checkpoints[state.collected]?.point
  let offStart: OffStart | undefined
  let lost = false
  if (offRoute && goal) {
    offStart = state.offStart ?? { from: state.player ?? position, point: position, odoM: odometer.totalM, goalM: haversine(position, goal) }
    const verdict = judgeDeviation(offStart, position, odometer.totalM, goal, cfg)
    lost = verdict === 'away' || (state.lost === true && verdict !== 'toward')
    if (verdict === 'toward' && (offStart.triedM === undefined || odometer.totalM - offStart.triedM >= cfg.retryM)) {
      offStart = { ...offStart, triedM: odometer.totalM }
      events.push({ type: 'reroute' })
    }
  }
  if (lost && !state.lost) events.push({ type: 'offRoute' })
  // The message ends: back on the line, or heading for the gem again.
  if (!lost && state.lost) events.push({ type: 'backOnRoute' })

  const prevAlong = state.alongM
  const alongM = onRoute ? snap.alongM : state.alongM
  const picked = collectCheckpoints(
    { route: state.route, collected: state.collected, position, prevAlongM: prevAlong, alongM, offsetM: snap.offsetM, onRoute, accuracyM: reported, walkedM: odometer.totalM, elapsedS: sinceLastS },
    cfg,
  )
  events.push(...picked.events)
  const collected = picked.collected
  const finished = state.route.checkpoints.length > 0 && collected >= state.route.checkpoints.length
  if (finished) events.push({ type: 'finished' })

  return {
    state: {
      ...state,
      filter: filtered.state,
      odometer,
      alongM,
      offRouteCount,
      offRoute,
      offStart,
      lost,
      collected,
      lastFixAt: fix.timestamp,
      finishedAt: finished ? fix.timestamp : undefined,
      player: offRoute ? position : snap.point,
      accuracy: reported,
      weakSince: undefined,
    },
    events,
  }
}
