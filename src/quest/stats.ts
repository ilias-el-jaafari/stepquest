import { haversine, type LatLon } from '../geo/geo.ts'
import { pointAlong } from '../routing/checkpoints.ts'
import { gemTotal } from './gems.ts'
import { snapToRoute } from './snap.ts'
import { trackFor, type QuestState } from './state.ts'

export type QuestStats = {
  walkedM: number
  steps: number
  elapsedMs: number
  /** Minutes per kilometre, undefined until 50 m have been walked. */
  paceMinPerKm: number | undefined
  collected: number
  total: number
}

/** Steps walked so far: the odometer divided by the stride. */
export function stepsWalked(state: QuestState): number {
  return Math.round(state.odometer.totalM / state.strideM)
}

export function questStats(state: QuestState, now: number): QuestStats {
  const end = state.finishedAt ?? now
  const elapsedMs = Math.max(0, end - state.startedAt)
  const walkedM = state.odometer.totalM
  return {
    walkedM,
    steps: stepsWalked(state),
    elapsedMs,
    paceMinPerKm: walkedM >= 50 ? elapsedMs / 60000 / (walkedM / 1000) : undefined,
    collected: state.collected,
    total: gemTotal(state.route),
  }
}

export function nextCheckpoint(state: QuestState) {
  return state.route.checkpoints[state.collected]
}

/** How far ahead on the route the "which way now" arrow looks. */
const AHEAD_M = 25

/**
 * Distance to the next checkpoint measured along the route (what the walker
 * will really walk), plus the way to head now: along the route ahead, or back
 * to the route when off it. Undefined when there is no next checkpoint.
 */
export function routeToNext(state: QuestState): { metres: number; toward: LatLon } | undefined {
  const next = nextCheckpoint(state)
  const player = state.player
  if (!next || !player) return undefined
  const track = trackFor(state.route)
  if (track.points.length < 2) return { metres: haversine(player, next.point), toward: next.point }
  const snap = snapToRoute(track, player, state.alongM)
  const from = state.offRoute ? snap.alongM : state.alongM
  const rest = Math.max(0, next.distanceM - from)
  // Off the line: first back to it, then along it.
  const metres = (state.offRoute ? snap.offsetM : 0) + rest
  const toward = state.offRoute && snap.offsetM > 15 ? snap.point : pointAlong(track.points, track.cumulative, Math.min(next.distanceM, from + AHEAD_M))
  return { metres, toward: haversine(player, toward) < 3 ? next.point : toward }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`
}

export function formatPace(minPerKm: number | undefined): string {
  if (minPerKm === undefined || !Number.isFinite(minPerKm) || minPerKm > 99) return '--'
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return s === 60 ? `${m + 1}'00"` : `${m}'${String(s).padStart(2, '0')}"`
}
