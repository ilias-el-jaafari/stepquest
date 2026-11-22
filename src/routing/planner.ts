import { bboxContains, destination, haversine, type BBox, type LatLon } from '../geo/geo.ts'
import { metresToSteps, stepsToMetres, TARGET_TOLERANCE, withinTolerance } from '../geo/steps.ts'
import { defaultCheckpointCount, placeCheckpoints, type Checkpoint } from './checkpoints.ts'
import type { WalkGraph } from './graph.ts'

export type RouteMode = 'loop' | 'oneway'

export type RouteRequest = {
  mode: RouteMode
  start: LatLon
  /** Required for one-way routes. */
  end?: LatLon
  targetSteps: number
  strideM: number
  /** Checkpoints to place; defaults to one per ~1,000 steps. */
  checkpoints?: number
  /** Changes the loop's direction so "Reroll" gives a different walk. */
  seed?: number
  /** Per-edge cost multipliers (safety weights; Infinity = never use). Lengths stay real. */
  cost?: Float32Array
  /** Smallest value in `cost` (keeps A* exact when some streets are preferred). */
  minCost?: number
}

export type Route = {
  mode: RouteMode
  points: LatLon[]
  nodes: number[]
  distanceM: number
  steps: number
  targetSteps: number
  targetM: number
  /** Signed error versus the target, as a fraction (0.03 = 3 % long). */
  error: number
  /** Fraction of the distance walked twice (out-and-back sections). */
  overlap: number
  checkpoints: Checkpoint[]
  withinTolerance: boolean
}

export type InfeasibleReason = 'tooShort' | 'tooLong' | 'noMatch' | 'outsideArea' | 'unreachable' | 'samePoint'

export type PlanResult =
  | { ok: true; route: Route }
  | {
      ok: false
      reason: InfeasibleReason
      /** Fewest steps that can work (e.g. the direct A→B distance). */
      minSteps?: number
      /** Most steps we could reach inside the loaded area. */
      maxSteps?: number
      /** Closest attempt, shown as a preview when there is one. */
      closest?: Route
    }

/** Below this snap distance a tapped point counts as "on the network". */
export const MAX_SNAP_M = 150
/** Street networks are longer than straight lines by roughly this factor. */
const DETOUR_FACTOR = 1.3
const REUSE_PENALTY = 6

type Leg = { nodes: number[]; edges: number[]; length: number }

function joinLegs(legs: Leg[]): { nodes: number[]; edges: number[]; length: number } {
  const nodes: number[] = []
  const edges: number[] = []
  let length = 0
  for (const leg of legs) {
    if (nodes.length && nodes[nodes.length - 1] === leg.nodes[0]) nodes.push(...leg.nodes.slice(1))
    else nodes.push(...leg.nodes)
    edges.push(...leg.edges)
    length += leg.length
  }
  return { nodes, edges, length }
}

function overlapOf(graph: WalkGraph, joined: { nodes: number[]; edges: number[] }): number {
  const seen = new Set<number>()
  let repeated = 0
  let total = 0
  for (let i = 1; i < joined.nodes.length; i++) {
    const e = joined.edges[i - 1]
    const len = graph.edgeLength(joined.nodes[i - 1]!, joined.nodes[i]!)
    total += len
    if (e === undefined) continue
    if (seen.has(e)) repeated += len
    else seen.add(e)
  }
  return total === 0 ? 0 : repeated / total
}

/** Route through the given graph nodes in order, discouraging reuse of streets. */
function routeVia(graph: WalkGraph, stops: number[], req: RouteRequest): Leg | undefined {
  const penalty = req.cost ? Float32Array.from(req.cost) : new Float32Array(graph.edgeCount).fill(1)
  const legs: Leg[] = []
  for (let i = 1; i < stops.length; i++) {
    const leg = graph.shortestPath(stops[i - 1]!, stops[i]!, penalty, req.minCost ?? 1)
    if (!leg) return undefined
    for (const e of leg.edges) penalty[e] = (req.cost?.[e] ?? 1) * REUSE_PENALTY
    legs.push(leg)
  }
  return joinLegs(legs)
}

function snap(graph: WalkGraph, p: LatLon, area: BBox): number | undefined {
  const clamped = {
    lat: Math.min(area.north, Math.max(area.south, p.lat)),
    lon: Math.min(area.east, Math.max(area.west, p.lon)),
  }
  return graph.nearestNode(clamped)?.node
}

function finish(graph: WalkGraph, req: RouteRequest, joined: Leg, targetM: number): Route {
  const points = joined.nodes.map((n) => graph.point(n))
  const steps = metresToSteps(joined.length, req.strideM)
  return {
    mode: req.mode,
    points,
    nodes: joined.nodes,
    distanceM: joined.length,
    steps,
    targetSteps: req.targetSteps,
    targetM,
    error: (joined.length - targetM) / targetM,
    overlap: overlapOf(graph, joined),
    checkpoints: placeCheckpoints(points, req.checkpoints ?? defaultCheckpointCount(steps)),
    withinTolerance: withinTolerance(joined.length, targetM),
  }
}

/** Lower is better: hitting the ±5 % window first, then little out-and-back walking. */
function score(route: Route): number {
  const distance = route.withinTolerance ? Math.abs(route.error) * 0.2 : 1 + Math.abs(route.error)
  return distance + route.overlap
}

/**
 * Tune one scalar size (a radius or an offset) so the routed length matches
 * the target. Lengths grow roughly linearly with size, so a damped secant
 * step converges in a handful of iterations.
 */
function tune(
  build: (size: number) => Route | undefined,
  targetM: number,
  initial: number,
  maxSize: number,
  iterations = 7,
): Route | undefined {
  let size = initial
  let best: Route | undefined
  for (let i = 0; i < iterations; i++) {
    const route = build(size)
    if (!route) {
      size *= 0.8
      continue
    }
    if (!best || score(route) < score(best)) best = route
    if (route.withinTolerance && route.overlap < 0.15) break
    const ratio = targetM / Math.max(1, route.distanceM)
    size = Math.min(maxSize, Math.max(20, size * (1 + (ratio - 1) * 0.9)))
  }
  return best
}

/** Deterministic pseudo-random in [0,1) from a seed. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function planLoop(graph: WalkGraph, req: RouteRequest, area: BBox): PlanResult {
  const targetM = stepsToMetres(req.targetSteps, req.strideM)
  if (!bboxContains(area, req.start)) return { ok: false, reason: 'outsideArea' }
  const start = graph.nearestNode(req.start)
  if (!start || start.distance > MAX_SNAP_M) return { ok: false, reason: 'unreachable' }

  const seed = req.seed ?? 0
  const baseBearing = hash01(seed + 1) * 360
  const span = Math.max(area.north - area.south, area.east - area.west) * 111_000
  let best: Route | undefined
  // Triangle loops: start → A → B → start, with A and B `size` metres away.
  for (let k = 0; k < 8; k++) {
    const bearing = (baseBearing + k * 45) % 360
    const spread = 70 + hash01(seed * 31 + k) * 40
    const route = tune(
      (size) => {
        const a = snap(graph, destination(req.start, bearing, size), area)
        const b = snap(graph, destination(req.start, bearing + spread, size), area)
        if (a === undefined || b === undefined || a === b || a === start.node || b === start.node) return undefined
        const joined = routeVia(graph, [start.node, a, b, start.node], req)
        return joined ? finish(graph, req, joined, targetM) : undefined
      },
      targetM,
      // Perimeter ≈ size × (2 + chord), chord ≈ 2 sin(spread/2).
      targetM / DETOUR_FACTOR / (2 + 2 * Math.sin((spread * Math.PI) / 360)),
      span,
    )
    if (route && (!best || score(route) < score(best))) best = route
    if (best && best.withinTolerance && best.overlap < 0.15) break
  }
  if (!best) return { ok: false, reason: 'noMatch' }
  if (best.withinTolerance) return { ok: true, route: best }
  const reason: InfeasibleReason = best.error < 0 ? 'tooLong' : 'noMatch'
  return { ok: false, reason, maxSteps: best.error < 0 ? best.steps : undefined, closest: best }
}

export function planOneWay(graph: WalkGraph, req: RouteRequest, area: BBox): PlanResult {
  const end = req.end
  if (!end) return { ok: false, reason: 'unreachable' }
  const targetM = stepsToMetres(req.targetSteps, req.strideM)
  if (!bboxContains(area, req.start) || !bboxContains(area, end)) return { ok: false, reason: 'outsideArea' }
  const a = graph.nearestNode(req.start)
  const b = graph.nearestNode(end)
  if (!a || !b || a.distance > MAX_SNAP_M || b.distance > MAX_SNAP_M) return { ok: false, reason: 'unreachable' }
  if (a.node === b.node) return { ok: false, reason: 'samePoint' }
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
  const good = (r: Route | undefined) => !!r && r.withinTolerance && r.overlap < 0.12
  let longest: Route | undefined
  const track = (r: Route | undefined) => {
    if (r && (!longest || r.distanceM > longest.distanceM)) longest = r
    return r
  }
  outer: for (const fraction of [0.5, 0.3, 0.7]) {
    const anchor = destination(req.start, bearingAB, straight * fraction)
    for (const side of [90, -90]) {
      // Shape 1: a single via point pushed sideways off the line A→B (an ellipse).
      const half = targetM / DETOUR_FACTOR / 2
      const h0 = Math.sqrt(Math.max(1, half * half - (straight / 2) ** 2))
      const viaOne = tune(
        (h) => {
          const w = snap(graph, destination(anchor, bearingAB + side, h), area)
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
          const w1 = snap(graph, destination(destination(req.start, bearingAB, straight * (fraction - 0.5)), bearingAB + side, h), area)
          const w2 = snap(graph, destination(destination(end, bearingAB, straight * (fraction - 0.5)), bearingAB + side, h), area)
          if (w1 === undefined || w2 === undefined || w1 === w2) return undefined
          const joined = routeVia(graph, [a.node, w1, w2, b.node], req)
          return joined ? track(finish(graph, req, joined, targetM)) : undefined
        },
        targetM,
        Math.max(30, extra / DETOUR_FACTOR / 2),
        span,
      )
      for (const r of [viaOne, viaTwo]) if (r && (!best || score(r) < score(best))) best = r
      if (good(best)) break outer
    }
  }
  // Long goals: the via shapes run out of room inside the area. Walk part of the way, do a
  // triangle loop off to one side of the direct path, then carry on to B (a "lollipop").
  if (!good(best)) {
    outerLoop: for (const fraction of [0.5, 0.3, 0.7]) {
      const m = direct.nodes[Math.min(direct.nodes.length - 1, Math.max(1, Math.round((direct.nodes.length - 1) * fraction)))]!
      if (m === a.node || m === b.node) continue
      const mid = graph.point(m)
      for (const side of [90, -90]) {
        const bearing = bearingAB + side - 45
        const loop = tune(
          (size) => {
            const p1 = snap(graph, destination(mid, bearing, size), area)
            const p2 = snap(graph, destination(mid, bearing + 90, size), area)
            if (p1 === undefined || p2 === undefined || p1 === p2 || p1 === m || p2 === m) return undefined
            const joined = routeVia(graph, [a.node, m, p1, p2, m, b.node], req)
            return joined ? track(finish(graph, req, joined, targetM)) : undefined
          },
          targetM,
          Math.max(30, extra / DETOUR_FACTOR / (2 + Math.SQRT2)),
          span,
        )
        if (loop && (!best || score(loop) < score(best))) best = loop
        if (good(best)) break outerLoop
      }
    }
  }
  if (best?.withinTolerance) return { ok: true, route: best }
  if (best && best.error < 0) {
    const far = longest ?? best
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
