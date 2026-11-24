import type { BBox, LatLon } from '../geo/geo.ts'
import { DEFAULT_FILTER, type FilterConfig, type FilterState, type Odometer, type RejectReason } from './gpsFilter.ts'
import { makeTrack, type RouteTrack } from './snap.ts'
import type { QuestRoute } from './types.ts'

export const QUEST_VERSION = 2

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
  /** Geometrically off the line (the walker is drawn at the raw position). */
  offRoute: boolean
  /** Where the walker left the line, to judge whether they still head for the goal. */
  offStart?: OffStart
  /** Clearly walking away from the goal: the "you left the route" message shows. */
  lost?: boolean
  /** How many times the rest of the route was recalculated. */
  rerouted?: number
  /** Walked stretches of the routes left behind by reroutes, so their footprints stay on the map. */
  walkedBefore?: LatLon[][]
  /** Steps of this quest already added to "steps today" (so crediting is done once). */
  creditedSteps?: number
  /** Position to draw the walker at (snapped to the route when on it). */
  player: LatLon | undefined
  /** Accuracy of the last accepted fix, metres. */
  accuracy: number | undefined
  /** Last time a fix was rejected for poor accuracy (drives the "weak GPS" hint). */
  weakSince: number | undefined
}

export type OffStart = {
  /** Last point on the route before leaving it. */
  from: LatLon
  /** First fix off the route. */
  point: LatLon
  /** Odometer reading at that fix. */
  odoM: number
  /** Straight-line distance to the next checkpoint at that fix. */
  goalM: number
  /** Odometer reading at the last reroute attempt (to retry only every so often). */
  triedM?: number
}

export type QuestEvent =
  | { type: 'collected'; index: number; isFinish: boolean; point: LatLon }
  | { type: 'finished' }
  | { type: 'rejected'; reason: RejectReason }
  | { type: 'offRoute' }
  | { type: 'backOnRoute' }
  /** Off the line but still heading for the goal: recalculate the rest of the route. */
  | { type: 'reroute' }

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
  /** Once off the route, the walker must come within this fraction of the off-route distance to count as on it again. */
  returnFactor: number
  /** "Walked past" a gem: the advance along the route may be this much whatever the time between fixes… */
  maxPassJumpM: number
  /** …or this fast (m/s) times the time since the previous fix, whichever is more. */
  passSpeedMps: number
  /** Walked this far off the line before deciding between rerouting and "you left the route". */
  decideM: number
  /** "Heading for the goal": within this many degrees of it… */
  towardDeg: number
  /** …or the goal is no further away than when leaving, give or take this slack. */
  goalSlackM: number
  /** Walked this far off the line, moving away, before the message shows. */
  lostM: number
  /** Retry a failed reroute after this much more walking. */
  retryM: number
}

export const DEFAULT_QUEST_CONFIG: QuestConfig = {
  filter: DEFAULT_FILTER,
  baseRadiusM: 22,
  maxRadiusM: 35,
  offRouteM: 40,
  offRouteFixes: 2,
  returnFactor: 0.7,
  maxPassJumpM: 100,
  passSpeedMps: 3,
  decideM: 20,
  towardDeg: 90,
  goalSlackM: 25,
  lostM: 60,
  retryM: 80,
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

