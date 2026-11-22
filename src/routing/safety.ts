import { LocalProjection, type LatLon } from '../geo/geo.ts'
import { SAFETY_ALLEY, SAFETY_COVERED, SAFETY_LIT, SAFETY_SIDEWALK, SAFETY_UNLIT, type OsmData, type OsmWay } from '../osm/types.ts'
import type { WalkGraph } from './graph.ts'

/**
 * Safety-weighted routing. There is no reliable public map of danger in
 * Spain, so this uses OpenStreetMap tags as proxies for streets that feel
 * safe to walk: lit, lively (shops and cafés nearby), with sidewalks,
 * pedestrian or residential, and not alleys, tunnels, industrial estates or
 * unlit paths. Each edge gets a cost multiplier (lower = preferred); the
 * route length itself is never changed, so the step goal still holds.
 */

export type SafetyOptions = {
  /** Prefer safer streets. */
  safe: boolean
  /** It will be dark: lighting and empty areas count much more. */
  night: boolean
  /** Street names never to walk along (hard avoid). */
  avoid: readonly string[]
}

/** What the cost function knows about one stretch of street. */
export type EdgeInfo = {
  highway: string | undefined
  /** SAFETY_* flags of the way. */
  flags: number
  tunnel: boolean
  /** Inside industrial or railway land. */
  industrial: boolean
  /** Inside a park or garden. */
  park: boolean
  /** Shops, cafés and the like within LIVELY_RADIUS_M. */
  lively: number
}

export const LIVELY_RADIUS_M = 40
export const MIN_FACTOR = 0.6
export const MAX_FACTOR = 6

const AVENUES = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'])
/** Busy main roads (primary, secondary, tertiary and their links). */
export function isAvenue(highway: string | undefined): boolean {
  return highway !== undefined && AVENUES.has(highway)
}
/** Night multiplier for a busy avenue with light, sidewalks or shops. */
export const AVENUE_NIGHT_BONUS = 0.95

/** Base preference by street type (1 = neutral). */
function typeFactor(highway: string | undefined, night: boolean): number {
  switch (highway) {
    case 'pedestrian':
    case 'living_street':
      return 0.8
    case 'residential':
      return 0.92
    case 'primary':
    case 'secondary':
    case 'tertiary':
    case 'primary_link':
    case 'secondary_link':
    case 'tertiary_link':
      // Busy avenues: neutral by type; a small night bonus is applied in safetyFactor
      // when they show signs of light and people (lit, sidewalks or shops).
      return 1
    case 'footway':
      return 1
    case 'unclassified':
    case 'road':
      return 1.1
    case 'service':
      return 1.35
    case 'steps':
      return 1.25
    case 'path':
    case 'bridleway':
      return night ? 1.8 : 1.3
    case 'track':
      return night ? 2.4 : 1.7
    default:
      return 1
  }
}

/** Cost multiplier for one stretch of street (≥ MIN_FACTOR, ≤ MAX_FACTOR). Pure. */
export function safetyFactor(e: EdgeInfo, night: boolean): number {
  let f = typeFactor(e.highway, night)
  const path = e.highway === 'footway' || e.highway === 'path' || e.highway === 'track' || e.highway === 'steps' || e.highway === 'bridleway'
  if (e.flags & SAFETY_LIT) f *= night ? 0.75 : 0.92
  else if (e.flags & SAFETY_UNLIT) f *= night ? 2.5 : 1.25
  // Unknown lighting: city streets are almost always lit; paths often are not.
  else if (night && path) f *= 1.5
  if (e.flags & SAFETY_SIDEWALK) f *= 0.93
  if (e.flags & SAFETY_ALLEY) f *= night ? 2 : 1.5
  if (e.tunnel || e.flags & SAFETY_COVERED) f *= night ? 3 : 2
  if (e.industrial) f *= night ? 2.2 : 1.5
  // Paths through parks are lovely by day, lonely after dark unless lit.
  if (night && e.park && path && !(e.flags & SAFETY_LIT)) f *= 1.8
  // At night a busy avenue with light, sidewalks or shops is slightly preferred, but less
  // than a lit residential or pedestrian street (AVENUE_NIGHT_BONUS > residential factor).
  if (night && isAvenue(e.highway) && (e.flags & (SAFETY_LIT | SAFETY_SIDEWALK) || e.lively > 0)) f *= AVENUE_NIGHT_BONUS
  if (e.lively >= 3) f *= night ? 0.75 : 0.85
  else if (e.lively >= 1) f *= night ? 0.88 : 0.93
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, f))
}

/** Names compared loosely: case, accents and extra spaces do not matter. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** All street names in the loaded area (walkable ways), sorted. */
export function streetNames(data: OsmData): string[] {
  const seen = new Map<string, string>()
  for (const w of data.ways) if (w.walkable && w.name && !seen.has(normalizeName(w.name))) seen.set(normalizeName(w.name), w.name)
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Street names matching a search (accent- and case-insensitive substring), best first. */
export function searchStreets(names: readonly string[], query: string, limit = 8): string[] {
  const q = normalizeName(query)
  if (!q) return []
  const hits = names.filter((n) => normalizeName(n).includes(q))
  hits.sort((a, b) => Number(!normalizeName(b).startsWith(q)) - Number(!normalizeName(a).startsWith(q)) || a.length - b.length)
  return hits.slice(0, limit)
}

/** Point-in-polygon (even-odd) on projected coordinates. */
function inside(x: number, y: number, xs: Float64Array, ys: Float64Array): boolean {
  let hit = false
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const yi = ys[i]!
    const yj = ys[j]!
    if (yi > y !== yj > y && x < ((xs[j]! - xs[i]!) * (y - yi)) / (yj - yi) + xs[i]!) hit = !hit
  }
  return hit
}

type Poly = { xs: Float64Array; ys: Float64Array; minX: number; maxX: number; minY: number; maxY: number }

/** Precomputed per-edge facts for an area (independent of the options). */
export type SafetyContext = { info: EdgeInfo[]; names: (string | undefined)[] }

/** Look up the safety facts of every graph edge. Done once per loaded area. */
export function safetyContext(graph: WalkGraph, data: OsmData): SafetyContext {
  const proj = new LocalProjection({ lat: (data.bbox.north + data.bbox.south) / 2, lon: (data.bbox.east + data.bbox.west) / 2 })
  const toPoly = (nodes: readonly number[]): Poly => {
    const xs = new Float64Array(nodes.length)
    const ys = new Float64Array(nodes.length)
    nodes.forEach((n, i) => {
      const p = proj.toXY({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 })
      xs[i] = p.x
      ys[i] = p.y
    })
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < xs.length; i++) {
      minX = Math.min(minX, xs[i]!)
      maxX = Math.max(maxX, xs[i]!)
      minY = Math.min(minY, ys[i]!)
      maxY = Math.max(maxY, ys[i]!)
    }
    return { xs, ys, minX, maxX, minY, maxY }
  }
  const industrial = (data.industrial ?? []).map(toPoly)
  const parks = data.ways.filter((w) => w.kind === 'park' && w.area).map((w) => toPoly(w.nodes))
  const within = (polys: Poly[], x: number, y: number) => polys.some((p) => x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && inside(x, y, p.xs, p.ys))

  // Lively places in a 50 m grid.
  const CELL = 50
  const grid = new Map<string, { x: number; y: number }[]>()
  const act = data.activity ?? []
  for (let i = 0; i + 1 < act.length; i += 2) {
    const p = proj.toXY({ lat: act[i]!, lon: act[i + 1]! })
    const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`
    const list = grid.get(key)
    if (list) list.push(p)
    else grid.set(key, [p])
  }
  const livelyAt = (x: number, y: number) => {
    let n = 0
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const p of grid.get(`${cx + dx}:${cy + dy}`) ?? []) if (Math.hypot(p.x - x, p.y - y) <= LIVELY_RADIUS_M) n++
    return n
  }

  const info: EdgeInfo[] = new Array(graph.edgeCount)
  const names: (string | undefined)[] = new Array(graph.edgeCount)
  for (let n = 0; n < graph.size; n++) {
    for (let i = graph.offsets[n]!; i < graph.offsets[n + 1]!; i++) {
      const e = graph.edgeIds[i]!
      if (info[e]) continue
      const m = graph.targets[i]!
      const way: OsmWay | undefined = data.ways[graph.edgeWay[e]!]
      const mid = proj.toXY({ lat: (graph.lat[n]! + graph.lat[m]!) / 2, lon: (graph.lon[n]! + graph.lon[m]!) / 2 })
      info[e] = {
        highway: way?.highway,
        flags: way?.safety ?? 0,
        tunnel: way?.tunnel ?? false,
        industrial: industrial.length > 0 && within(industrial, mid.x, mid.y),
        park: parks.length > 0 && within(parks, mid.x, mid.y),
        lively: livelyAt(mid.x, mid.y),
      }
      names[e] = way?.name
    }
  }
  return { info, names }
}

/**
 * Per-edge cost multipliers for the planner, plus the smallest one (for A*).
 * Avoided streets get Infinity (closed). Returns undefined when nothing applies.
 */
export function edgeCosts(ctx: SafetyContext, opts: SafetyOptions): { cost: Float32Array; min: number; closed: number } | undefined {
  const avoid = new Set(opts.avoid.map(normalizeName))
  if (!opts.safe && avoid.size === 0) return undefined
  const cost = new Float32Array(ctx.info.length)
  let min = 1
  let closed = 0
  for (let e = 0; e < cost.length; e++) {
    const name = ctx.names[e]
    if (name && avoid.has(normalizeName(name))) {
      cost[e] = Infinity
      closed++
      continue
    }
    const f = opts.safe ? safetyFactor(ctx.info[e]!, opts.night) : 1
    cost[e] = f
    if (f < min) min = f
  }
  return { cost, min, closed }
}

/** How "comfortable" a route is: share of its length on preferred streets, and on lit ones. */
export function routeSafety(graph: WalkGraph, ctx: SafetyContext, nodes: readonly number[], night: boolean): { preferred: number; lit: number } {
  let total = 0
  let preferred = 0
  let lit = 0
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!
    const b = nodes[i]!
    for (let k = graph.offsets[a]!; k < graph.offsets[a + 1]!; k++) {
      if (graph.targets[k] !== b) continue
      const len = graph.lengths[k]!
      const info = ctx.info[graph.edgeIds[k]!]!
      total += len
      if (safetyFactor(info, night) <= 1) preferred += len
      if (info.flags & SAFETY_LIT) lit += len
      break
    }
  }
  return total ? { preferred: preferred / total, lit: lit / total } : { preferred: 0, lit: 0 }
}

/** Names of avoided streets that a route still walks along. */
export function avoidedOnRoute(graph: WalkGraph, ctx: SafetyContext, nodes: readonly number[], avoid: readonly string[]): string[] {
  const wanted = new Map(avoid.map((n) => [normalizeName(n), n]))
  const hit = new Set<string>()
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!
    const b = nodes[i]!
    for (let k = graph.offsets[a]!; k < graph.offsets[a + 1]!; k++) {
      if (graph.targets[k] !== b) continue
      const name = ctx.names[graph.edgeIds[k]!]
      const label = name ? wanted.get(normalizeName(name)) : undefined
      if (label) hit.add(label)
      break
    }
  }
  return [...hit]
}

/** Polylines of every walkable way whose name is on the avoid list (for drawing them on the map). */
export function avoidedPolylines(data: OsmData, avoid: readonly string[]): LatLon[][] {
  if (avoid.length === 0) return []
  const wanted = new Set(avoid.map(normalizeName))
  const out: LatLon[][] = []
  for (const w of data.ways) {
    if (!w.walkable || !w.name || !wanted.has(normalizeName(w.name))) continue
    out.push(w.nodes.map((n) => ({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 })))
  }
  return out
}

/** The named street nearest to a tapped point (within maxM metres), for "tap to avoid". */
export function nearestStreet(data: OsmData, p: LatLon, maxM = 35): string | undefined {
  const proj = new LocalProjection(p)
  let best: string | undefined
  let bestD = maxM
  for (const w of data.ways) {
    if (!w.walkable || !w.name) continue
    for (let i = 1; i < w.nodes.length; i++) {
      const a = proj.toXY({ lat: data.lat[w.nodes[i - 1]!] ?? 0, lon: data.lon[w.nodes[i - 1]!] ?? 0 })
      const b = proj.toXY({ lat: data.lat[w.nodes[i]!] ?? 0, lon: data.lon[w.nodes[i]!] ?? 0 })
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0
      const d = Math.hypot(a.x + t * dx, a.y + t * dy)
      if (d < bestD) {
        bestD = d
        best = w.name
      }
    }
  }
  return best
}
