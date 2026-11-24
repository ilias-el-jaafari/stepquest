import { bboxContains, destination, haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { MAX_STEPS, metresToSteps, MIN_STEPS, stepsToMetres, TARGET_TOLERANCE } from '../geo/steps.ts'
import type { WalkGraph } from './graph.ts'
import type { InfeasibleReason, PlanResult, Route, RouteRequest } from './planTypes.ts'
import { finish, isClean, routeVia, score } from './routeBuild.ts'
import { Attempts, hash01, tune } from './tune.ts'

/**
 * Public API of the route planners: `planRoute` (dispatches on `req.mode`),
 * `planLoop`, `planOneWay` and `bearingBetween`. Types live in `planTypes.ts`,
 * route assembly in `routeBuild.ts`, the size search in `tune.ts`, the graph
 * and A* in `graph.ts`, safety weights in `safety.ts`.
 */
export type { InfeasibleReason, PlanResult, Route, RouteMode, RouteRequest } from './planTypes.ts'

/**
 * Distances that answer "is this point near enough?", from loosest to tightest.
 * They are tuned together; keep the order when changing one:
 *
 * - `MAX_SNAP_M` (150 m, here): a tapped start/finish farther than this from the
 *   walkable network is "unreachable".
 * - `snapToRoute` window (`src/quest/snap.ts`, 60 m behind / 400 m ahead of the last position):
 *   where along the planned route a GPS fix may snap.
 * - `offRouteM` (40 m, `src/quest/quest.ts`): the fix is off the route beyond this.
 * - `decideM` (20 m, same file): walking this far off the line decides "toward" or "away".
 * - `retryM` (80 m, same file): walking needed before a failed reroute is retried.
 * - `JOIN_SNAP_M` (8 m, `src/quest/reroute.ts`): a reconnection must start and end this close
 *   to the graph and the planned line. It must stay far below `MAX_SNAP_M`.
 */
export const MAX_SNAP_M = 150
/** Street networks are longer than straight lines by roughly this factor. */
const DETOUR_FACTOR = 1.3

/** Goals outside [MIN_STEPS, MAX_STEPS] are refused before any search (also NaN and ±Infinity). */
function outOfRange(targetSteps: number): PlanResult | undefined {
  if (Number.isFinite(targetSteps) && targetSteps >= MIN_STEPS && targetSteps <= MAX_STEPS) return undefined
  return { ok: false, reason: 'outOfRange', minSteps: MIN_STEPS, maxSteps: MAX_STEPS }
}

function snap(graph: WalkGraph, p: LatLon, area: BBox, component: number): number | undefined {
  const clamped = {
    lat: Math.min(area.north, Math.max(area.south, p.lat)),
    lon: Math.min(area.east, Math.max(area.west, p.lon)),
  }
  return graph.nearestNode(clamped, true, component)?.node
}

/**
 * A walk that returns to the start. Tries triangle loops (start → A → B → start)
 * in eight directions, tuning the triangle size to the goal.
 *
 * Infeasible results: `tooLong` (the best loop is shorter than the goal),
 * `tooShort` (every loop built is more than 5 % longer than the goal), else
 * `noMatch`. All of them carry `minSteps`/`maxSteps` (the shortest and longest
 * loop built) and the closest loop as a preview.
 */
export function planLoop(graph: WalkGraph, req: RouteRequest, area: BBox): PlanResult {
  const refused = outOfRange(req.targetSteps)
  if (refused) return refused
  const targetM = stepsToMetres(req.targetSteps, req.strideM)
  if (!bboxContains(area, req.start)) return { ok: false, reason: 'outsideArea' }
  const start = graph.nearestNode(req.start)
  if (!start || start.distance > MAX_SNAP_M) return { ok: false, reason: 'unreachable' }

  const network = graph.component[start.node]!
  const seed = req.seed ?? 0
  const baseBearing = hash01(seed + 1) * 360
  const span = Math.max(area.north - area.south, area.east - area.west) * 111_000
  const attempts = new Attempts()
  let best: Route | undefined
  for (let k = 0; k < 8; k++) {
    const bearing = (baseBearing + k * 45) % 360
    const spread = 70 + hash01(seed * 31 + k) * 40
    const route = tune(
      (size) => {
        const a = snap(graph, destination(req.start, bearing, size), area, network)
        const b = snap(graph, destination(req.start, bearing + spread, size), area, network)
        if (a === undefined || b === undefined || a === b || a === start.node || b === start.node) return undefined
        const joined = routeVia(graph, [start.node, a, b, start.node], req)
        return attempts.track(joined ? finish(graph, req, joined, targetM) : undefined)
      },
      targetM,
      // Perimeter ≈ size × (2 + chord), chord ≈ 2 sin(spread/2).
      targetM / DETOUR_FACTOR / (2 + 2 * Math.sin((spread * Math.PI) / 360)),
      span,
    )
    if (route && (!best || score(route) < score(best))) best = route
    if (isClean(best)) break
  }
  if (!best || !attempts.shortest || !attempts.longest) return { ok: false, reason: 'noMatch' }
  if (best.withinTolerance) return { ok: true, route: best }
  const reason: InfeasibleReason =
    best.error < 0 ? 'tooLong' : attempts.shortest.distanceM > targetM * (1 + TARGET_TOLERANCE) ? 'tooShort' : 'noMatch'
  return { ok: false, reason, minSteps: attempts.shortest.steps, maxSteps: attempts.longest.steps, closest: best }
}

/**
 * A walk from A to B that adds detours until it matches the goal: one via
 * point, two via points, then a triangle loop off the direct path.
 */
export function planOneWay(graph: WalkGraph, req: RouteRequest, area: BBox): PlanResult {
  const refused = outOfRange(req.targetSteps)
  if (refused) return refused
  const end = req.end
  if (!end) return { ok: false, reason: 'unreachable' }
  const targetM = stepsToMetres(req.targetSteps, req.strideM)
  if (!bboxContains(area, req.start) || !bboxContains(area, end)) return { ok: false, reason: 'outsideArea' }
  const a = graph.nearestNode(req.start)
  const b = a && graph.nearestNode(end, true, graph.component[a.node])
  if (!a || !b || a.distance > MAX_SNAP_M || b.distance > MAX_SNAP_M) return { ok: false, reason: 'unreachable' }
  if (a.node === b.node) return { ok: false, reason: 'samePoint' }
  const network = graph.component[a.node]!
  const direct = graph.shortestPath(a.node, b.node, req.cost, req.minCost ?? 1)
  if (!direct) return { ok: false, reason: 'unreachable' }
  const directRoute = finish(graph, req, direct, targetM)
  const minSteps = metresToSteps(direct.length, req.strideM)

  if (targetM < direct.length * (1 - TARGET_TOLERANCE)) {
    return { ok: false, reason: 'tooShort', minSteps, closest: directRoute }
  }
  if (directRoute.withinTolerance) return { ok: true, route: directRoute }

  // Detour: push one or two via points sideways from the straight line A→B.
  const straight = haversine(req.start, end)
  const bearingAB = bearingBetween(req.start, end)
  const extra = targetM - direct.length
  const span = Math.max(area.north - area.south, area.east - area.west) * 111_000
  let best: Route | undefined
  const attempts = new Attempts()
  const track = (r: Route | undefined) => attempts.track(r)
  outer: for (const fraction of [0.5, 0.3, 0.7]) {
    const anchor = destination(req.start, bearingAB, straight * fraction)
    for (const side of [90, -90]) {
      // Shape 1: a single via point pushed sideways off the line A→B (an ellipse).
      const half = targetM / DETOUR_FACTOR / 2
      const h0 = Math.sqrt(Math.max(1, half * half - (straight / 2) ** 2))
      const viaOne = tune(
        (h) => {
          const w = snap(graph, destination(anchor, bearingAB + side, h), area, network)
          if (w === undefined || w === a.node || w === b.node) return undefined
          const joined = routeVia(graph, [a.node, w, b.node], req)
          return joined ? track(finish(graph, req, joined, targetM)) : undefined
        },
        targetM,
        h0,
        span,
      )
      // Shape 2: a "bracket" with two via points, better for long targets.
      const viaTwo = tune(
        (h) => {
          const w1 = snap(graph, destination(destination(req.start, bearingAB, straight * (fraction - 0.5)), bearingAB + side, h), area, network)
          const w2 = snap(graph, destination(destination(end, bearingAB, straight * (fraction - 0.5)), bearingAB + side, h), area, network)
          if (w1 === undefined || w2 === undefined || w1 === w2) return undefined
          const joined = routeVia(graph, [a.node, w1, w2, b.node], req)
          return joined ? track(finish(graph, req, joined, targetM)) : undefined
        },
        targetM,
        Math.max(30, extra / DETOUR_FACTOR / 2),
        span,
      )
      for (const r of [viaOne, viaTwo]) if (r && (!best || score(r) < score(best))) best = r
      if (isClean(best)) break outer
    }
  }
  // Long goals: the via shapes run out of room inside the area. Walk part of the way, do a
  // triangle loop off to one side of the direct path, then carry on to B (a "lollipop").
  if (!isClean(best)) {
    outerLoop: for (const fraction of [0.5, 0.3, 0.7]) {
      const m = direct.nodes[Math.min(direct.nodes.length - 1, Math.max(1, Math.round((direct.nodes.length - 1) * fraction)))]!
      if (m === a.node || m === b.node) continue
      const mid = graph.point(m)
      for (const side of [90, -90]) {
        const bearing = bearingAB + side - 45
        const loop = tune(
          (size) => {
            const p1 = snap(graph, destination(mid, bearing, size), area, network)
            const p2 = snap(graph, destination(mid, bearing + 90, size), area, network)
            if (p1 === undefined || p2 === undefined || p1 === p2 || p1 === m || p2 === m) return undefined
            const joined = routeVia(graph, [a.node, m, p1, p2, m, b.node], req)
            return joined ? track(finish(graph, req, joined, targetM)) : undefined
          },
          targetM,
          Math.max(30, extra / DETOUR_FACTOR / (2 + Math.SQRT2)),
          span,
        )
        if (loop && (!best || score(loop) < score(best))) best = loop
        if (isClean(best)) break outerLoop
      }
    }
  }
  if (best?.withinTolerance) return { ok: true, route: best }
  if (best && best.error < 0) {
    const far = attempts.longest ?? best
    return { ok: false, reason: 'tooLong', minSteps, maxSteps: far.steps, closest: far }
  }
  return { ok: false, reason: 'noMatch', minSteps, closest: best ?? directRoute }
}

export function bearingBetween(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad)
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lon - a.lon) * toRad)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function planRoute(graph: WalkGraph, req: RouteRequest, area: BBox): PlanResult {
  return req.mode === 'loop' ? planLoop(graph, req, area) : planOneWay(graph, req, area)
}
