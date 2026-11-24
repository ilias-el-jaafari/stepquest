import { haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { metresToSteps, TARGET_TOLERANCE } from '../geo/steps.ts'
import { isDark } from '../geo/sun.ts'
import type { OsmData } from '../osm/types.ts'
import type { WalkGraph } from '../routing/graph.ts'
import { MAX_SNAP_M } from '../routing/planner.ts'
import { planWithSafety } from '../routing/safePlanner.ts'
import { edgeCosts, nearestStreet, type SafetyContext } from '../routing/safety.ts'
import { cumulativeDistances, headOf, type Checkpoint } from '../routing/checkpoints.ts'
import type { QuestState } from './quest.ts'
import { makeTrack, snapToRoute } from './snap.ts'
import type { QuestRoute } from './types.ts'

export type RerouteWorld = { graph: WalkGraph; ctx: SafetyContext; data: OsmData; bbox: BBox }

/** Too few steps left to be worth replanning. */
const MIN_REMAINING_STEPS = 150
/** The reconnection must start and end this close to the graph and the planned line. */
const JOIN_SNAP_M = 8

/**
 * The new route for a quest, as plain data (it crosses the worker boundary).
 * It is only valid for the quest and reroute count it was computed from.
 */
export type ReroutePatch = {
  questId: string
  /** `rerouted` of the state it was computed from; the patch is refused once that has changed. */
  base: number
  /** Gems collected in the state it was computed from; the patch is refused once another gem was collected. */
  collected: number
  /** Where the walker was when it was computed; the patch is refused once the walker is far from there. */
  from: LatLon
  /** `local`: reconnected to the planned route; `full`: the whole remainder was replanned. */
  kind: 'local' | 'full'
  route: QuestRoute
  /** Walked stretch of the route that was left behind (for the footprints). */
  walked: LatLon[]
}

/** Steps still to walk to hit the goal, from the odometer. */
function stepsLeft(state: QuestState): number {
  return state.route.targetSteps - metresToSteps(state.odometer.totalM, state.strideM)
}

const withinBudget = (steps: number, remaining: number) => Math.abs(steps - remaining) <= remaining * TARGET_TOLERANCE + 1

function safetyOptions(state: QuestState, world: RerouteWorld, opts: { avoid: readonly string[]; now: number }, here: LatLon, remaining: number) {
  const leftStreet = state.offStart ? nearestStreet(world.data, state.offStart.from) : undefined
  const avoid = leftStreet && !opts.avoid.includes(leftStreet) ? [...opts.avoid, leftStreet] : [...opts.avoid]
  const walkMs = (remaining * state.strideM) / 1.3 * 1000
  const night = isDark(opts.now, here) || isDark(opts.now + walkMs, here)
  return { safe: true, night, avoid }
}

/**
 * First try: walk from here straight back to the planned route. A safety-weighted
 * shortest path to a point ahead on the route (not behind the walker, not past the
 * next gem), then the old route and every uncollected gem as they were. Accepted
 * only when the step budget still lands within ±5 %. One A* per candidate.
 */
function reconnect(state: QuestState, world: RerouteWorld, here: LatLon, remaining: number, safety: { safe: boolean; night: boolean; avoid: string[] }): ReroutePatch | undefined {
  const route = state.route
  const next = route.checkpoints[state.collected]
  if (!next || route.points.length < 2) return undefined
  const start = world.graph.nearestNode(here)
  if (!start || start.distance > MAX_SNAP_M) return undefined
  const costs = edgeCosts(world.ctx, safety)
  const track = makeTrack(route.points)
  const snap = snapToRoute(track, here, state.alongM)
  const from = Math.max(snap.alongM, state.alongM)
  if (next.distanceM <= from) return undefined
  const offset = Math.max(snap.offsetM, 30)
  // Rejoin vertices: one offset ahead, two offsets ahead, and the next gem itself.
  const wanted = [from + offset, from + offset * 2, next.distanceM].map((d) => Math.min(d, next.distanceM))
  // Last vertex at or before each wanted distance: never past the next gem, never behind the walker.
  const last = (d: number) => track.cumulative.findLastIndex((c) => c <= d + 1e-6)
  const vertices = [...new Set(wanted.map(last))].filter((i) => i > 0 && track.cumulative[i]! >= from - 1e-6)
  let best: { patch: ReroutePatch; err: number } | undefined
  for (const i of vertices) {
    const joinPoint = route.points[i]!
    const join = world.graph.nearestNode(joinPoint)
    if (!join || join.distance > JOIN_SNAP_M) continue
    const leg = world.graph.shortestPath(start.node, join.node, costs?.cost, costs?.min ?? 1)
    if (!leg) continue
    const points = [...leg.nodes.map((n) => world.graph.point(n)), ...route.points.slice(i + 1)]
    const distanceM = cumulativeDistances(points).at(-1) ?? 0
    const steps = metresToSteps(distanceM, state.strideM)
    if (!withinBudget(steps, remaining)) continue
    const err = Math.abs(steps - remaining)
    if (best && best.err <= err) continue
    // Gems keep their place; their distance is measured back from the finish, which is unchanged.
    const toEnd = (c: Checkpoint) => route.distanceM - c.distanceM
    const checkpoints = route.checkpoints.map((c, k) => (k < state.collected ? c : { ...c, distanceM: Math.max(0, distanceM - toEnd(c)) }))
    best = {
      err,
      patch: {
        questId: state.id,
        base: state.rerouted ?? 0,
        collected: state.collected,
        from: here,
        kind: 'local',
        route: { ...route, points, distanceM, steps: Math.round(metresToSteps(state.odometer.totalM, state.strideM) + steps), checkpoints },
        walked: headOf(route.points, state.alongM),
      },
    }
  }
  return best?.patch
}

/**
 * The rest of the quest from where the walker is now. First a quick reconnection to
 * the planned route; when that cannot keep the remaining step budget (±5 %), a
 * safety-weighted walk to the finish that places the uncollected checkpoints evenly
 * and avoids the street they just left. Collected checkpoints, walked distance and
 * the walked footprints stay. Undefined when no route fits.
 */
export function planReroute(state: QuestState, world: RerouteWorld, opts: { avoid: readonly string[]; now: number; local?: boolean }): ReroutePatch | undefined {
  const here = state.player
  const route = state.route
  const finish = route.checkpoints[route.checkpoints.length - 1]
  const left = route.checkpoints.length - state.collected
  if (!here || !finish || left <= 0 || state.finishedAt !== undefined) return undefined
  const remaining = stepsLeft(state)
  if (remaining < MIN_REMAINING_STEPS) return undefined
  const safety = safetyOptions(state, world, opts, here, remaining)
  const quick = opts.local === false ? undefined : reconnect(state, world, here, remaining, safety)
  if (quick) return quick
  const plan = planWithSafety(
    world.graph,
    world.ctx,
    { mode: 'oneway', start: here, end: finish.point, targetSteps: Math.round(remaining), strideM: state.strideM, checkpoints: left, seed: (state.rerouted ?? 0) + 1 },
    world.bbox,
    safety,
  )
  const r = plan.result.ok ? plan.result.route : undefined
  if (!r || !withinBudget(r.steps, remaining)) return undefined
  const done = route.checkpoints.slice(0, state.collected)
  const next = r.checkpoints.map((c) => ({ ...c, index: c.index + state.collected }))
  const walkedSteps = metresToSteps(state.odometer.totalM, state.strideM)
  return {
    questId: state.id,
    base: state.rerouted ?? 0,
    collected: state.collected,
    from: here,
    kind: 'full',
    route: { ...route, points: r.points, distanceM: r.distanceM, steps: Math.round(walkedSteps + r.steps), checkpoints: [...done, ...next] },
    walked: headOf(route.points, state.alongM),
  }
}

/** A patch is refused when the walker is further than this from where it was computed. */
export const PATCH_MAX_DRIFT_M = 60

/**
 * Whether a patch still belongs to this quest state: same quest, no reroute applied since, the
 * same number of gems collected, the walker still off the route and still near the position the
 * patch starts from. Otherwise the answer is stale; the next off-route stretch asks again.
 */
export function patchFits(state: QuestState | undefined, patch: ReroutePatch): state is QuestState {
  return (
    !!state &&
    state.id === patch.questId &&
    (state.rerouted ?? 0) === patch.base &&
    state.collected === patch.collected &&
    state.finishedAt === undefined &&
    state.offRoute &&
    !!state.player &&
    haversine(state.player, patch.from) <= PATCH_MAX_DRIFT_M
  )
}

/** Merge a patch into the (possibly newer) quest state. Undefined when it no longer fits. */
export function applyReroute(state: QuestState | undefined, patch: ReroutePatch): QuestState | undefined {
  if (!patchFits(state, patch)) return undefined
  return {
    ...state,
    route: patch.route,
    alongM: 0,
    offRouteCount: 0,
    offRoute: false,
    offStart: undefined,
    lost: false,
    rerouted: patch.base + 1,
    walkedBefore: patch.walked.length > 1 ? [...(state.walkedBefore ?? []), patch.walked] : state.walkedBefore,
  }
}

/** Synchronous reroute (tests, scripts): plan and apply in one go. */
export function rerouteQuest(state: QuestState, world: RerouteWorld, opts: { avoid: readonly string[]; now: number }): QuestState | undefined {
  const patch = planReroute(state, world, opts)
  return patch ? applyReroute(state, patch) : undefined
}
