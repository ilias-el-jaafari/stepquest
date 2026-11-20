import { haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { advanceOdometer, DEFAULT_FILTER, filterFix, type FilterConfig, type FilterState, type Odometer, type RejectReason } from './gpsFilter.ts'
import { makeTrack, snapToRoute, type RouteTrack } from './snap.ts'
import type { GpsFix, QuestRoute } from './types.ts'

export const QUEST_VERSION = 1

export type SimSettings = { timeScale: number; noiseM: number }

/** Which map the quest was planned on, so a reload can bring the same map back. */
export type AreaRef = { kind: 'demo' } | { kind: 'live'; bbox: BBox }

/** Everything about a running quest; plain JSON so it can live in localStorage. */
export type QuestState = {
  v: typeof QUEST_VERSION
  id: string
  route: QuestRoute
  strideM: number
  area: AreaRef
  simulated: boolean
  /** Simulation settings, so a reload resumes the same demo walk. */
  sim: SimSettings | undefined
  startedAt: number
  lastFixAt: number | undefined
  finishedAt: number | undefined
  /** Number of checkpoints collected; the next one to collect is checkpoints[collected]. */
  collected: number
  filter: FilterState | undefined
  odometer: Odometer
  /** Progress along the route (last on-route snap), metres. */
  alongM: number
  offRouteCount: number
  offRoute: boolean
  /** Position to draw the walker at (snapped to the route when on it). */
  player: LatLon | undefined
  /** Accuracy of the last accepted fix, metres. */
  accuracy: number | undefined
  /** Last time a fix was rejected for poor accuracy (drives the "weak GPS" hint). */
  weakSince: number | undefined
}

export type QuestEvent =
  | { type: 'collected'; index: number; isFinish: boolean; point: LatLon }
  | { type: 'finished' }
  | { type: 'rejected'; reason: RejectReason }
  | { type: 'offRoute' }
  | { type: 'backOnRoute' }

export type QuestConfig = {
  filter: FilterConfig
  /** Base pickup radius in metres. */
  baseRadiusM: number
  /** Largest pickup radius, however poor the accuracy. */
  maxRadiusM: number
  /** Off the route by more than this (or 1.5 × accuracy) counts as off-route. */
  offRouteM: number
  /** Consecutive off-route fixes before the hint appears. */
  offRouteFixes: number
  /** Furthest forward a single fix may advance progress when "passing" checkpoints. */
  maxPassJumpM: number
}

export const DEFAULT_QUEST_CONFIG: QuestConfig = {
  filter: DEFAULT_FILTER,
  baseRadiusM: 22,
  maxRadiusM: 35,
  offRouteM: 40,
  offRouteFixes: 2,
  maxPassJumpM: 400,
}

/** Pickup radius grows with poor accuracy (half of anything above 10 m), capped. */
export function collectRadius(accuracyM: number, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): number {
  const extra = Math.max(0, (Number.isFinite(accuracyM) ? accuracyM : 0) - 10) * 0.5
  return Math.min(cfg.maxRadiusM, cfg.baseRadiusM + extra)
}

export function offRouteThreshold(accuracyM: number, cfg: QuestConfig = DEFAULT_QUEST_CONFIG): number {
  return Math.max(cfg.offRouteM, accuracyM * 1.5)
}

export function createQuest(
  route: QuestRoute,
  opts: { strideM: number; area: AreaRef; simulated: boolean; now: number; id?: string; sim?: SimSettings },
): QuestState {
  return {
    v: QUEST_VERSION,
    id: opts.id ?? `q${opts.now.toString(36)}`,
    route,
    strideM: opts.strideM,
    area: opts.area,
    simulated: opts.simulated,
    sim: opts.sim,
    startedAt: opts.now,
    lastFixAt: undefined,
    finishedAt: undefined,
    collected: 0,
    filter: undefined,
    odometer: { anchor: undefined, totalM: 0 },
    alongM: 0,
    offRouteCount: 0,
    offRoute: false,
    player: route.points[0],
    accuracy: undefined,
    weakSince: undefined,
  }
}

const tracks = new WeakMap<QuestRoute, RouteTrack>()
export function trackFor(route: QuestRoute): RouteTrack {
  let t = tracks.get(route)
  if (!t) {
    t = makeTrack(route.points)
    tracks.set(route, t)
  }
  return t
}

/**
 * Feed one GPS fix into the quest. Returns the next state and what happened
 * (pickups, finish, off-route changes). Pure apart from a geometry cache.
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

  const { position, accuracy } = filtered
  const track = trackFor(state.route)
  const snap = snapToRoute(track, position, state.alongM)
  const threshold = offRouteThreshold(fix.accuracy, cfg)
  const onRoute = snap.offsetM <= threshold
  const offRouteCount = onRoute ? 0 : state.offRouteCount + 1
  const offRoute = offRouteCount >= cfg.offRouteFixes
  if (offRoute && !state.offRoute) events.push({ type: 'offRoute' })
  if (!offRoute && state.offRoute) events.push({ type: 'backOnRoute' })

  const prevAlong = state.alongM
  const alongM = onRoute ? snap.alongM : state.alongM
  const radius = collectRadius(fix.accuracy, cfg)
  let collected = state.collected
  const cps = state.route.checkpoints
  while (collected < cps.length) {
    const cp = cps[collected]!
    const near = haversine(position, cp.point) <= radius
    // Sparse fixes can skip over a checkpoint; walking past it along the route counts too.
    // It must be a real crossing of the checkpoint's position on the route, close to the line.
    const passed =
      onRoute && snap.offsetM <= radius && prevAlong < cp.distanceM && alongM >= cp.distanceM && alongM - prevAlong <= cfg.maxPassJumpM
    if (!near && !passed) break
    events.push({ type: 'collected', index: cp.index, isFinish: cp.isFinish, point: cp.point })
    collected++
  }
  const finished = cps.length > 0 && collected >= cps.length
  if (finished) events.push({ type: 'finished' })

  return {
    state: {
      ...state,
      filter: filtered.state,
      odometer: advanceOdometer(state.odometer, position, accuracy),
      alongM,
      offRouteCount,
      offRoute,
      collected,
      lastFixAt: fix.timestamp,
      finishedAt: finished ? fix.timestamp : undefined,
      player: offRoute ? position : snap.point,
      accuracy: fix.accuracy,
      weakSince: undefined,
    },
    events,
  }
}

export type QuestStats = {
  walkedM: number
  steps: number
  elapsedMs: number
  /** Minutes per kilometre, undefined until 50 m have been walked. */
  paceMinPerKm: number | undefined
  collected: number
  total: number
  remainingM: number
}

export function questStats(state: QuestState, now: number): QuestStats {
  const end = state.finishedAt ?? now
  const elapsedMs = Math.max(0, end - state.startedAt)
  const walkedM = state.odometer.totalM
  return {
    walkedM,
    steps: Math.round(walkedM / state.strideM),
    elapsedMs,
    paceMinPerKm: walkedM >= 50 ? elapsedMs / 60000 / (walkedM / 1000) : undefined,
    collected: state.collected,
    total: state.route.checkpoints.length,
    remainingM: Math.max(0, state.route.distanceM - state.alongM),
  }
}

export function nextCheckpoint(state: QuestState) {
  return state.route.checkpoints[state.collected]
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
