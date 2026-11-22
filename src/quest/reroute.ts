import type { BBox } from '../geo/geo.ts'
import { metresToSteps, TARGET_TOLERANCE } from '../geo/steps.ts'
import { isDark } from '../geo/sun.ts'
import type { OsmData } from '../osm/types.ts'
import type { WalkGraph } from '../routing/graph.ts'
import { planWithSafety } from '../routing/safePlanner.ts'
import { nearestStreet, type SafetyContext } from '../routing/safety.ts'
import { headOf } from '../routing/checkpoints.ts'
import type { QuestState } from './quest.ts'

export type RerouteWorld = { graph: WalkGraph; ctx: SafetyContext; data: OsmData; bbox: BBox }

/** Too few steps left to be worth replanning. */
const MIN_REMAINING_STEPS = 150

/**
 * The rest of the quest from where the walker is now: a safety-weighted walk
 * to the finish that keeps the remaining step budget (±5 %), places the
 * uncollected checkpoints evenly on it and avoids the street they just left.
 * Collected checkpoints, walked distance and the walked footprints stay. Undefined when no route fits.
 */
export function rerouteQuest(state: QuestState, world: RerouteWorld, opts: { avoid: readonly string[]; now: number }): QuestState | undefined {
  const here = state.player
  const route = state.route
  const finish = route.checkpoints[route.checkpoints.length - 1]
  const left = route.checkpoints.length - state.collected
  if (!here || !finish || left <= 0 || state.finishedAt !== undefined) return undefined
  const walkedSteps = metresToSteps(state.odometer.totalM, state.strideM)
  const remaining = route.targetSteps - walkedSteps
  if (remaining < MIN_REMAINING_STEPS) return undefined
  const leftStreet = state.offStart ? nearestStreet(world.data, state.offStart.from) : undefined
  const avoid = leftStreet && !opts.avoid.includes(leftStreet) ? [...opts.avoid, leftStreet] : [...opts.avoid]
  const walkMs = (remaining * state.strideM) / 1.3 * 1000
  const night = isDark(opts.now, here) || isDark(opts.now + walkMs, here)
  const plan = planWithSafety(
    world.graph,
    world.ctx,
    { mode: 'oneway', start: here, end: finish.point, targetSteps: Math.round(remaining), strideM: state.strideM, checkpoints: left, seed: (state.rerouted ?? 0) + 1 },
    world.bbox,
    { safe: true, night, avoid },
  )
  const r = plan.result.ok ? plan.result.route : undefined
  if (!r || Math.abs(r.steps - remaining) > remaining * TARGET_TOLERANCE + 1) return undefined
  const done = route.checkpoints.slice(0, state.collected)
  const next = r.checkpoints.map((c) => ({ ...c, index: c.index + state.collected }))
  const walked = headOf(route.points, state.alongM)
  return {
    ...state,
    route: { ...route, points: r.points, distanceM: r.distanceM, steps: Math.round(walkedSteps + r.steps), checkpoints: [...done, ...next] },
    alongM: 0,
    offRouteCount: 0,
    offRoute: false,
    offStart: undefined,
    lost: false,
    player: here,
    rerouted: (state.rerouted ?? 0) + 1,
    walkedBefore: walked.length > 1 ? [...(state.walkedBefore ?? []), walked] : state.walkedBefore,
  }
}

