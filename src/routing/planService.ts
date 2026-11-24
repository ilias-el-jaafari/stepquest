import type { OsmData } from '../osm/types.ts'
import { planReroute } from '../quest/reroute.ts'
import { WalkGraph } from './graph.ts'
import type { PlanRequest, PlanResponse } from './planProtocol.ts'
import { planWithSafety } from './safePlanner.ts'
import { safetyContext, type SafetyContext } from './safety.ts'

export type PlanWorld = { data: OsmData; graph: WalkGraph; ctx: SafetyContext }

/**
 * The planning logic behind the worker, with no worker in it: holds the maps by
 * id and answers requests one at a time. The worker file and the main-thread
 * fallback both run exactly this.
 */
export class PlanService {
  private readonly worlds = new Map<number, PlanWorld>()

  /** Use a map that is already built (the main-thread fallback shares its graph instead of building another). */
  adopt(worldId: number, world: PlanWorld): void {
    this.worlds.set(worldId, world)
  }

  has(worldId: number): boolean {
    return this.worlds.has(worldId)
  }

  handle(msg: PlanRequest): PlanResponse | undefined {
    const t0 = performance.now()
    const ms = () => performance.now() - t0
    try {
      switch (msg.type) {
        case 'world': {
          const graph = new WalkGraph(msg.data)
          this.worlds.set(msg.worldId, { data: msg.data, graph, ctx: safetyContext(graph, msg.data) })
          return { type: 'ready', worldId: msg.worldId, ms: ms() }
        }
        case 'drop':
          this.worlds.delete(msg.worldId)
          return undefined
        case 'plan': {
          const w = this.world(msg.worldId)
          return { type: 'plan', id: msg.id, plan: planWithSafety(w.graph, w.ctx, msg.req, msg.area, msg.opts), ms: ms() }
        }
        case 'reroute': {
          const w = this.world(msg.worldId)
          const patch = planReroute(msg.state, { graph: w.graph, ctx: w.ctx, data: w.data, bbox: w.data.bbox }, { avoid: msg.avoid, now: msg.now })
          return { type: 'reroute', id: msg.id, patch, ms: ms() }
        }
      }
    } catch (error) {
      return { type: 'error', id: 'id' in msg ? msg.id : undefined, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private world(worldId: number): PlanWorld {
    const w = this.worlds.get(worldId)
    if (!w) throw new Error(`unknown world ${worldId}`)
    return w
  }
}
