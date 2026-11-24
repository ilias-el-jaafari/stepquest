import type { BBox } from '../geo/geo.ts'
import type { WalkGraph } from './graph.ts'
import { planRoute, type PlanResult, type RouteRequest } from './planner.ts'
import { avoidedOnRoute, edgeCosts, routeSafety, type SafetyContext, type SafetyOptions } from './safety.ts'

export type SafePlan = {
  result: PlanResult
  /**
   * - `safeInfeasible`: no safety-weighted route meets the step goal; `normal` holds one that does.
   * - `avoidIgnored`: the avoided streets could not all be avoided; the route uses `avoidedUsed`.
   */
  notice?: 'safeInfeasible' | 'avoidIgnored'
  /** A plain (not safety-weighted) route that meets the goal, offered as an alternative. */
  normal?: PlanResult & { ok: true }
  avoidedUsed?: string[]
  /** Avoided streets that the offered `normal` route still walks along (it only drops the list when nothing else fits). */
  normalAvoidedUsed?: string[]
  /** Share of the shown route on preferred streets and on lit streets (safe mode only). */
  safety?: { preferred: number; lit: number }
  /** Whether lighting was weighted for darkness. */
  night: boolean
}

function plan(graph: WalkGraph, ctx: SafetyContext, req: RouteRequest, area: BBox, opts: SafetyOptions): PlanResult {
  const costs = edgeCosts(ctx, opts)
  return planRoute(graph, costs ? { ...req, cost: costs.cost, minCost: costs.min } : req, area)
}

/**
 * Plan with safety weights and the avoid list, falling back clearly:
 * 1. safe + avoid; 2. if that fails, safe without the avoid list (noting which
 * avoided streets are used); 3. if safe routing cannot meet the goal at all,
 * keep the safe attempt as a preview and offer a normal route.
 */
export function planWithSafety(graph: WalkGraph, ctx: SafetyContext, req: RouteRequest, area: BBox, opts: SafetyOptions): SafePlan {
  const withStats = (p: SafePlan): SafePlan => {
    const shown = p.result.ok ? p.result.route : p.result.closest
    if (opts.safe && shown) p.safety = routeSafety(graph, ctx, shown.nodes, opts.night)
    return p
  }
  const first = plan(graph, ctx, req, area, opts)
  if (first.ok || (!opts.safe && opts.avoid.length === 0)) return withStats({ result: first, night: opts.night })

  if (opts.avoid.length > 0) {
    const free = plan(graph, ctx, req, area, { ...opts, avoid: [] })
    if (free.ok) {
      const used = avoidedOnRoute(graph, ctx, free.route.nodes, opts.avoid)
      return withStats({ result: free, notice: used.length ? 'avoidIgnored' : undefined, avoidedUsed: used, night: opts.night })
    }
  }
  if (opts.safe) {
    const normal = plan(graph, ctx, req, area, { ...opts, safe: false })
    if (normal.ok) return withStats({ result: first, notice: 'safeInfeasible', normal, night: opts.night })
    // The avoid list may be the only thing in the way: offer a normal route that uses the avoided streets, and name them.
    if (opts.avoid.length > 0) {
      const any = plan(graph, ctx, req, area, { ...opts, safe: false, avoid: [] })
      if (any.ok) {
        const used = avoidedOnRoute(graph, ctx, any.route.nodes, opts.avoid)
        return withStats({ result: first, notice: 'safeInfeasible', normal: any, normalAvoidedUsed: used.length ? used : undefined, night: opts.night })
      }
    }
  }
  return withStats({ result: first, night: opts.night })
}
