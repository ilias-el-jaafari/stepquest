import { bboxContains, type BBox } from '../geo/geo.ts'
import { QUEST_VERSION, type QuestState } from './state.ts'
import type { QuestRoute } from './types.ts'

export type MigrateResult = { ok: true; quest: QuestState } | { ok: false; reason: 'invalid' | 'newer' }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLatLon = (p: unknown): boolean => isObj(p) && num(p.lat) && num(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

/**
 * One step per version: `MIGRATIONS[n]` turns a saved quest of version n into version n + 1.
 * Add a step here (and bump `QUEST_VERSION`) whenever the saved shape changes.
 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: `creditedSteps` (steps already added to "steps today"). Nothing was credited as walked before.
  1: (old) => ({ ...old, v: 2, creditedSteps: 0 }),
}

function validRoute(r: unknown): boolean {
  if (!isObj(r) || !Array.isArray(r.points) || r.points.length < 2 || !r.points.every(isLatLon)) return false
  if (!num(r.distanceM) || r.distanceM < 0 || !Array.isArray(r.checkpoints) || r.checkpoints.length === 0) return false
  return r.checkpoints.every((c) => isObj(c) && num(c.index) && num(c.distanceM) && typeof c.isFinish === 'boolean' && isLatLon(c.point))
}

/** Field checks for the current version. A quest that fails them could finish or misbehave at the next fix. */
function validQuest(q: Record<string, unknown>): boolean {
  if (typeof q.id !== 'string' || !num(q.startedAt) || !num(q.strideM) || q.strideM <= 0 || !validRoute(q.route)) return false
  const total = (q.route as QuestRoute).checkpoints.length
  if (!Number.isInteger(q.collected) || (q.collected as number) < 0 || (q.collected as number) > total) return false
  if (!isObj(q.odometer) || !num(q.odometer.totalM) || q.odometer.totalM < 0) return false
  if (!isObj(q.area) || (q.area.kind !== 'demo' && q.area.kind !== 'live')) return false
  if (q.area.kind === 'live' && !(isObj(q.area.bbox) && [q.area.bbox.south, q.area.bbox.west, q.area.bbox.north, q.area.bbox.east].every(num))) return false
  if (q.finishedAt !== undefined && (!num(q.finishedAt) || (q.collected as number) < total)) return false
  if (q.lastFixAt !== undefined && !num(q.lastFixAt)) return false
  if (!num(q.alongM) || q.alongM < 0) return false
  if (q.creditedSteps !== undefined && (!num(q.creditedSteps) || q.creditedSteps < 0)) return false
  return true
}

/**
 * Bring a saved quest of any older version to the current one and validate it. A quest saved by a
 * newer app (after a downgrade) is reported as `newer` so the caller can leave it in storage.
 */
export function migrateQuest(raw: unknown): MigrateResult {
  if (!isObj(raw) || !Number.isInteger(raw.v) || (raw.v as number) < 1) return { ok: false, reason: 'invalid' }
  let q: Record<string, unknown> = raw
  if ((q.v as number) > QUEST_VERSION) return { ok: false, reason: 'newer' }
  while ((q.v as number) < QUEST_VERSION) {
    const step = MIGRATIONS[q.v as number]
    if (!step) return { ok: false, reason: 'invalid' }
    q = step(q)
  }
  return validQuest(q) ? { ok: true, quest: q as unknown as QuestState } : { ok: false, reason: 'invalid' }
}

/** Degrees of slack around the loaded map (about 500 m): ways crossing its edge reach a little outside it. */
const MAP_MARGIN_DEG = 0.005

/**
 * Does this route belong on this map? The start and every gem must lie inside the map (with a small margin).
 * A quest saved on another map, or on a demo extract that changed, fails this and is not resumed.
 */
export function routeNearBbox(route: QuestRoute, bbox: BBox): boolean {
  const wide: BBox = { south: bbox.south - MAP_MARGIN_DEG, west: bbox.west - MAP_MARGIN_DEG, north: bbox.north + MAP_MARGIN_DEG, east: bbox.east + MAP_MARGIN_DEG }
  const first = route.points[0]
  return !!first && bboxContains(wide, first) && route.checkpoints.every((c) => bboxContains(wide, c.point))
}
