import type { BBox } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import type { ReroutePatch } from '../quest/reroute.ts'
import type { QuestState } from '../quest/quest.ts'
import type { RouteRequest } from './planner.ts'
import type { SafePlan } from './safePlanner.ts'
import type { SafetyOptions } from './safety.ts'

/** Messages to the planning worker. Everything is plain data (structured-clone safe). */
export type PlanRequest =
  /** Load a map: the worker builds its own walking graph and safety context, once. */
  | { type: 'world'; worldId: number; data: OsmData }
  | { type: 'plan'; id: number; worldId: number; req: RouteRequest; area: BBox; opts: SafetyOptions }
  | { type: 'reroute'; id: number; worldId: number; state: QuestState; avoid: string[]; now: number }
  /** Forget a map that is no longer shown. */
  | { type: 'drop'; worldId: number }

/** Messages from the planning worker. */
export type PlanResponse =
  | { type: 'ready'; worldId: number; ms: number }
  | { type: 'plan'; id: number; plan: SafePlan; ms: number }
  | { type: 'reroute'; id: number; patch: ReroutePatch | undefined; ms: number }
  | { type: 'error'; id: number | undefined; message: string }

/** Requests that carry an id and get an answer, by name. */
export type RequestKind = 'plan' | 'reroute'
