import { haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { unionBox } from '../world/coverage.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import type { PlanResult, RouteMode } from '../routing/planner.ts'
import type { SafePlan } from '../routing/safePlanner.ts'
import type { LocationErrorCode } from '../quest/geolocation.ts'
import { addAvoid, loadAvoid } from '../ui/avoidList.ts'
import { hasSeenOnboarding } from '../ui/onboarding.ts'
import { loadSettings, type Settings } from '../ui/settings.ts'
import type { Tab } from '../ui/tabs.ts'

export type LocateStatus =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'loadingArea' }
  /** The location was found but the streets around it did not load (requirement 6e.3). */
  | { state: 'areaError' }
  | { state: 'ok'; accuracy: number; weak: boolean }
  | { state: 'error'; code: LocationErrorCode; accuracy?: number }

/** `running` while a request is out; `failed` after the planner broke (not "no route": that is a result). */
export type PlanStatus = 'idle' | 'running' | 'failed'

/** What a running plan is doing: reading the streets of the area, or searching the route. */
export type PlanPhase = 'streets' | 'route'
/** Why a plan failed: the streets would not load, loading took too long, or the search itself broke. */
export type PlanError = 'streets' | 'timeout' | 'failed'

export type MapStatus = 'loading' | 'ready' | 'failed'

/**
 * Everything the planning screens remember, as plain data. The loaded map (`World`) is big and
 * not serialisable, so it lives next to this state, not in it.
 */
export type AppState = {
  settings: Settings
  avoid: readonly string[]
  tab: Tab
  intro: boolean
  start: LatLon
  end: LatLon | undefined
  placing: 'start' | 'end'
  result: PlanResult | undefined
  safePlan: SafePlan | undefined
  usingNormal: boolean
  /**
   * `token` numbers planning requests. Any change to the inputs bumps it, so an answer that
   * arrives for older inputs no longer matches and is dropped.
   */
  plan: { status: PlanStatus; token: number; seed: number; phase?: PlanPhase; progress?: { done: number; total: number }; error?: PlanError }
  plannerOpen: boolean
  pickingAvoid: boolean
  pickNote: { ok: boolean; name?: string } | undefined
  /** The street the A → B finish was snapped to (requirement 25.7); valid while `end` is still `at`. */
  finishNote: { name?: string; at: LatLon } | undefined
  isDemo: boolean
  liveBox: BBox | undefined
  askHere: boolean
  viewCentre: LatLon | undefined
  locate: LocateStatus
  mapStatus: MapStatus
  /** The quest on screen was restored after a reload. */
  resumed: boolean
  /** A saved quest exists on a live map that could not be loaded. */
  resumeFailed: boolean
  coordsText: string
  coordsError: boolean
}

export type AppAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'intro'; open: boolean }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'mode'; mode: RouteMode }
  | { type: 'avoid'; list: readonly string[] }
  | { type: 'place'; which: 'start' | 'end' }
  | { type: 'point'; p: LatLon; street?: { name?: string } }
  | { type: 'pickStreet'; name: string | undefined }
  | { type: 'pickMode'; on: boolean }
  | { type: 'pickCancel' }
  | { type: 'planStart'; token: number; seed: number }
  | { type: 'planDone'; token: number; plan: SafePlan }
  | { type: 'planProgress'; token: number; phase: PlanPhase; progress?: { done: number; total: number } }
  | { type: 'planFailed'; token: number; error?: PlanError }
  | { type: 'areaGrown'; box: BBox }
  | { type: 'planCancelled'; token: number }
  | { type: 'useNormal' }
  | { type: 'togglePlanner' }
  | { type: 'locate'; status: LocateStatus }
  | { type: 'located'; p: LatLon }
  | { type: 'askHere'; on: boolean }
  | { type: 'view'; centre: LatLon | undefined }
  | { type: 'areaLoaded'; box: BBox; at: LatLon }
  | { type: 'liveRestored'; box: BBox }
  | { type: 'demo' }
  | { type: 'resetPoints' }
  | { type: 'mapStatus'; status: MapStatus }
  | { type: 'resumed' }
  | { type: 'resumeFailed' }
  | { type: 'questStarted' }
  | { type: 'coords'; text: string }
  | { type: 'coordsError'; on: boolean }

export const DEFAULT_COORDS_TEXT = '39.4935, -0.3920'

/** The state of a self-playing demo run: fixed settings, no intro, nothing read from the device. */
export function demoAppState(settings: Settings): AppState {
  return { ...initialAppState(), settings, avoid: [], intro: false }
}

export function initialAppState(): AppState {
  return {
    settings: loadSettings(),
    avoid: loadAvoid(),
    tab: 'map',
    intro: !hasSeenOnboarding(),
    start: DEMO_AREA.defaultStart,
    end: DEMO_AREA.defaultEnd,
    placing: 'start',
    result: undefined,
    safePlan: undefined,
    usingNormal: false,
    plan: { status: 'idle', token: 0, seed: 0 },
    plannerOpen: false,
    pickingAvoid: false,
    pickNote: undefined,
    finishNote: undefined,
    isDemo: true,
    liveBox: undefined,
    askHere: false,
    viewCentre: undefined,
    locate: { state: 'idle' },
    mapStatus: 'loading',
    resumed: false,
    resumeFailed: false,
    coordsText: DEFAULT_COORDS_TEXT,
    coordsError: false,
  }
}

/** The inputs changed: forget the route and make any request still out stale. */
function clearPlan(s: AppState): AppState {
  return {
    ...s,
    result: undefined,
    safePlan: undefined,
    usingNormal: false,
    plan: { status: 'idle', token: s.plan.token + 1, seed: s.plan.seed },
  }
}

const sameSettings = (a: Settings, b: Settings) => a.mode === b.mode && a.targetSteps === b.targetSteps && a.strideM === b.strideM

/** A finish that no walk of the goal's length could reach from `start` is forgotten (requirement 12.7). */
const reachable = (start: LatLon, end: LatLon | undefined, settings: Settings): boolean => !!end && haversine(start, end) <= stepsToMetres(settings.targetSteps, settings.strideM) / 1.3

/** The finish the demo area starts with is a place in Benicalap, not one the player chose. */
const isDemoEnd = (end: LatLon | undefined) => !!end && end.lat === DEMO_AREA.defaultEnd.lat && end.lon === DEMO_AREA.defaultEnd.lon

const placingFor = (mode: RouteMode): 'start' | 'end' => (mode === 'oneway' ? 'end' : 'start')

export function appReducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'tab':
      return s.tab === a.tab ? s : { ...s, tab: a.tab }
    case 'intro':
      return s.intro === a.open ? s : { ...s, intro: a.open }
    case 'settings': {
      const settings = { ...s.settings, ...a.patch }
      return sameSettings(settings, s.settings) ? s : clearPlan({ ...s, settings })
    }
    case 'mode': {
      if (a.mode === s.settings.mode) return s
      const next = clearPlan({ ...s, settings: { ...s.settings, mode: a.mode } })
      // The next tap sets the finish in A → B (requirement 12.7), the start in a loop.
      return { ...next, placing: placingFor(a.mode) }
    }
    case 'avoid':
      return clearPlan({ ...s, avoid: a.list })
    case 'place':
      return s.placing === a.which ? s : { ...s, placing: a.which }
    case 'point':
      return clearPlan(s.settings.mode === 'oneway' && s.placing === 'end' ? { ...s, end: a.p, finishNote: a.street ? { ...a.street, at: a.p } : undefined } : { ...s, start: a.p, finishNote: undefined })
    case 'pickStreet': {
      if (!a.name) return { ...s, pickNote: { ok: false } }
      return clearPlan({ ...s, pickNote: { ok: true, name: a.name }, pickingAvoid: false, tab: 'bag', avoid: addAvoid(s.avoid, a.name) })
    }
    case 'pickMode':
      return { ...s, pickingAvoid: a.on, pickNote: undefined, tab: a.on ? 'map' : s.tab }
    case 'pickCancel':
      return { ...s, pickingAvoid: false, pickNote: undefined, tab: 'bag' }
    case 'planStart':
      // One request at a time: a second press while one is out does nothing.
      if (s.plan.status === 'running') return s
      return { ...s, plan: { status: 'running', token: a.token, seed: a.seed, phase: 'route' } }
    case 'planProgress':
      if (a.token !== s.plan.token || s.plan.status !== 'running') return s
      return { ...s, plan: { ...s.plan, phase: a.phase, progress: a.progress } }
    case 'planDone':
      if (a.token !== s.plan.token || s.plan.status !== 'running') return s
      return { ...s, safePlan: a.plan, usingNormal: false, result: a.plan.result, plannerOpen: false, plan: { status: 'idle', token: s.plan.token, seed: s.plan.seed } }
    case 'planFailed':
      if (a.token !== s.plan.token || s.plan.status !== 'running') return s
      return { ...s, plan: { status: 'failed', token: s.plan.token, seed: s.plan.seed, error: a.error ?? 'failed' } }
    case 'planCancelled':
      if (a.token !== s.plan.token || s.plan.status !== 'running') return s
      return { ...s, plan: { status: 'idle', token: s.plan.token, seed: s.plan.seed } }
    case 'useNormal':
      if (!s.safePlan?.normal) return s
      return { ...s, usingNormal: true, result: s.safePlan.normal }
    case 'togglePlanner':
      return { ...s, plannerOpen: !s.plannerOpen }
    case 'locate':
      return { ...s, locate: a.status, askHere: a.status.state === 'locating' ? false : s.askHere }
    case 'located':
      return clearPlan({ ...s, start: a.p, end: reachable(a.p, s.end, s.settings) && !isDemoEnd(s.end) ? s.end : undefined, placing: placingFor(s.settings.mode) })
    case 'areaGrown':
      return { ...s, isDemo: false, liveBox: s.liveBox ? unionBox([s.liveBox, a.box]) : a.box }
    case 'askHere':
      return s.askHere === a.on ? s : { ...s, askHere: a.on }
    case 'view':
      return { ...s, viewCentre: a.centre }
    case 'areaLoaded':
      return clearPlan({ ...s, askHere: false, isDemo: false, liveBox: a.box, start: a.at, end: undefined, placing: placingFor(s.settings.mode), viewCentre: undefined })
    case 'liveRestored':
      return { ...s, isDemo: false, liveBox: a.box }
    case 'demo':
      return clearPlan({ ...s, isDemo: true, liveBox: undefined, start: DEMO_AREA.defaultStart, end: DEMO_AREA.defaultEnd })
    case 'resetPoints':
      return clearPlan({ ...s, start: DEMO_AREA.defaultStart, end: DEMO_AREA.defaultEnd })
    case 'mapStatus':
      return s.mapStatus === a.status ? s : { ...s, mapStatus: a.status }
    case 'resumed':
      return { ...s, resumed: true, resumeFailed: false }
    case 'resumeFailed':
      return { ...s, resumeFailed: true }
    case 'questStarted':
      return s.resumed ? { ...s, resumed: false } : s
    case 'coords':
      return { ...s, coordsText: a.text }
    case 'coordsError':
      return s.coordsError === a.on ? s : { ...s, coordsError: a.on }
  }
}
