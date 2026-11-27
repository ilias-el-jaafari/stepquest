import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { classifyWay, isBridge, isTunnel, isWalkable, wayStyle, type Tags } from '../osm/classify.ts'
import { dedupePois, landmarkKind } from '../osm/landmarks.ts'
import { dedupeSights, sightFromPoi } from '../sights/classify.ts'
import { distanceToRingM, pointInRing } from '../sights/geometry.ts'
import { FOOTPRINT_REACH_M, groundKind, hasFootprint } from '../sights/grounds.ts'
import type { Ground, Sight } from '../sights/types.ts'
import type { OsmData, OsmWay, Poi } from '../osm/types.ts'
import { latOf, lonOf, tileBBox, type TileId } from './tileMath.ts'

/**
 * OpenMapTiles vector tile -> our map model (requirement 21.3). Every feature is turned into the OSM
 * tags it came from, as far as the schema keeps them, and then goes through the same rules as an
 * Overpass answer (`classifyWay`, `wayStyle`, `landmarkKind`), so a street, a park or a supermarket
 * looks the same whichever source drew it.
 *
 * Geometry is clipped exactly at the tile edge (the tile's own buffer is dropped), in tile units,
 * before it is turned into degrees from the global integer coordinate: the edge shared by two
 * neighbours is the same number on both sides, so their halves of a building or a street meet
 * without a gap or an overlap. Pure: no DOM, no network.
 */

type P = { x: number; y: number }

/** OpenMapTiles road classes and the highway value they stand for. `minor` covers residential, unclassified, living street and road. */
const ROAD_CLASS: Record<string, string> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'residential',
  service: 'service',
  track: 'track',
  busway: 'busway',
}
const RAILS = new Set(['rail', 'light_rail', 'tram', 'subway', 'narrow_gauge'])
const LINK = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** Tags of a `transportation` feature, or undefined when it is not drawn (ferries, lifts, construction). */
export function transportationTags(p: Record<string, unknown>, polygon: boolean): Tags | undefined {
  const cls = str(p.class)
  const sub = str(p.subclass)
  if (!cls) return undefined
  const tags: Tags = {}
  if (p.brunnel === 'bridge') tags.bridge = 'yes'
  if (p.brunnel === 'tunnel') tags.tunnel = 'yes'
  if (str(p.foot)) tags.foot = str(p.foot)
  if (str(p.access)) tags.access = str(p.access)
  if (cls === 'rail' || cls === 'transit') {
    if (!sub || !RAILS.has(sub)) return undefined
    return { ...tags, railway: sub }
  }
  if (cls === 'path') {
    if (!sub) return undefined
    tags.highway = sub
    if (polygon) tags.area = 'yes'
    return tags
  }
  const hw = ROAD_CLASS[cls]
  if (!hw) return undefined
  // Road areas (wide carriageways) are drawn by their centre lines.
  if (polygon) return undefined
  tags.highway = p.ramp === 1 && LINK.has(hw) ? `${hw}_link` : hw
  return tags
}

/** `landcover` class/subclass -> the OSM tag it came from. */
function landcoverTags(p: Record<string, unknown>): Tags | undefined {
  const cls = str(p.class)
  const sub = str(p.subclass)
  switch (sub) {
    case 'park':
    case 'garden':
    case 'recreation_ground':
      return sub === 'recreation_ground' ? { landuse: sub } : { leisure: sub }
    case 'grass':
    case 'meadow':
    case 'village_green':
    case 'allotments':
    case 'farmland':
    case 'orchard':
    case 'forest':
      return { landuse: sub }
    case 'vineyard':
      return { landuse: 'farmland' }
    case 'wood':
    case 'scrub':
    case 'grassland':
    case 'heath':
      return { natural: sub }
  }
  if (cls === 'grass') return { landuse: 'grass' }
  if (cls === 'wood') return { natural: 'wood' }
  if (cls === 'farmland') return { landuse: 'farmland' }
  return undefined
}

/** `landuse` class -> OSM tag (only what we draw: pitches, playgrounds, cemeteries; the rest is plain ground). */
function landuseTags(p: Record<string, unknown>): Tags | undefined {
  switch (str(p.class)) {
    case 'pitch':
      return { leisure: 'pitch' }
    case 'playground':
      return { leisure: 'playground' }
    case 'cemetery':
      return { landuse: 'cemetery' }
    default:
      return undefined
  }
}

/** `water` class -> OSM tag; pools and underground water are not drawn (the Overpass extract did not have them either). */
function waterTags(p: Record<string, unknown>): Tags | undefined {
  const cls = str(p.class)
  if (!cls || cls === 'swimming_pool' || p.brunnel === 'tunnel') return undefined
  return { natural: 'water' }
}

function waterwayTags(p: Record<string, unknown>): Tags | undefined {
  const cls = str(p.class)
  if (!cls) return undefined
  return { waterway: cls, ...(p.brunnel === 'tunnel' ? { tunnel: 'yes' } : {}), ...(p.brunnel === 'bridge' ? { bridge: 'yes' } : {}) }
}

/** `poi` class/subclass -> OSM tags that `landmarkKind` understands. */
export function poiTags(p: Record<string, unknown>): Tags | undefined {
  const cls = str(p.class)
  const sub = str(p.subclass)
  const name = str(p.name) ?? str(p['name:latin'])
  if (sub === 'supermarket') return { shop: 'supermarket', name }
  if (cls === 'hospital' && (sub === 'hospital' || sub === 'clinic')) return { amenity: sub, name }
  if (cls === 'railway' && (sub === 'station' || sub === 'halt' || sub === 'subway')) return { railway: 'station', name }
  if ((cls === 'school' || cls === 'college') && sub && ['school', 'kindergarten', 'college', 'university'].includes(sub)) return { amenity: sub, name }
  return undefined
}

/** Sutherland-Hodgman clip of a ring to [0, e]²; the result is closed (first point repeated) or empty. */
export function clipRing(ring: readonly P[], e: number): P[] {
  let pts: P[] = ring.slice()
  if (pts.length > 1 && pts[0]!.x === pts[pts.length - 1]!.x && pts[0]!.y === pts[pts.length - 1]!.y) pts.pop()
  const edges: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= e, (a, b) => ({ x: e, y: a.y + ((b.y - a.y) * (e - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= e, (a, b) => ({ x: a.x + ((b.x - a.x) * (e - a.y)) / (b.y - a.y), y: e })],
  ]
  for (const [inside, cut] of edges) {
    if (!pts.length) break
    const out: P[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!
      const prev = pts[(i + pts.length - 1) % pts.length]!
      const a = inside(cur)
      const b = inside(prev)
      if (a) {
        if (!b) out.push(cut(prev, cur))
        out.push(cur)
      } else if (b) out.push(cut(prev, cur))
    }
    pts = out
  }
  if (pts.length < 3) return []
  return [...pts, pts[0]!]
}

/** Clip a polyline to [0, e]²; a line that leaves and comes back becomes several. */
export function clipLine(line: readonly P[], e: number): P[][] {
  const out: P[][] = []
  let cur: P[] | undefined
  for (let k = 1; k < line.length; k++) {
    const seg = clipSegment(line[k - 1]!, line[k]!, e)
    if (!seg) {
      cur = undefined
      continue
    }
    const [a, b] = seg
    const last = cur?.[cur.length - 1]
    if (!cur || !last || last.x !== a.x || last.y !== a.y) out.push((cur = [a]))
    cur.push(b)
  }
  return out.filter((l) => l.length >= 2)
}

/** Liang-Barsky. */
function clipSegment(a: P, b: P, e: number): [P, P] | undefined {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const checks: [number, number][] = [
    [-dx, a.x],
    [dx, e - a.x],
    [-dy, a.y],
    [dy, e - a.y],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return undefined
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return undefined
      if (r > t0) t0 = r
    } else {
      if (r < t0) return undefined
      if (r < t1) t1 = r
    }
  }
  // Exact end points stay exact (no t*d round-off for an end that was not cut).
  const at = (t: number): P => (t === 0 ? a : t === 1 ? b : { x: a.x + t * dx, y: a.y + t * dy })
  const p0 = at(t0)
  const p1 = at(t1)
  // Snap cut points onto the edge they were cut at, so both neighbours hold the same number.
  const snap = (p: P): P => ({ x: Math.abs(p.x) < 1e-9 ? 0 : Math.abs(p.x - e) < 1e-9 ? e : p.x, y: Math.abs(p.y) < 1e-9 ? 0 : Math.abs(p.y - e) < 1e-9 ? e : p.y })
  return [snap(p0), snap(p1)]
}

export type TileOptions = {
  /** A coarse tile (requirement 21.4): every way, no points of interest (a coarse cell gets no town). */
  coarse?: boolean
}

/** A polygon ring of the tile as flat `[lat, lon, ...]`, clipped at the tile edge like every polygon, not closed. */
function flatRing(ring: readonly P[], e: number, t: TileId): number[] {
  const clipped = clipRing(ring, e)
  const out: number[] = []
  for (const q of clipped.slice(0, -1)) out.push(latOf((t.y * e + q.y) / e, t.z), lonOf((t.x * e + q.x) / e, t.z))
  return out.length >= 6 ? out : []
}

/** Decode one MVT and convert it to the map model (clipped at the tile edge, degrees, OSM-style kinds). */
export function tileToOsm(bytes: Uint8Array, t: TileId, opts: TileOptions = {}): OsmData {
  const vt = new VectorTile(new PbfReader(bytes))
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = []
  const candidates: Poi[] = []
  const sightCandidates: Sight[] = []
  const grounds: Ground[] = []
  const buildingRings: number[][] = []
  let id = 1
  const nodeFrom = (e: number) => (p: P) => {
    lat.push(latOf((t.y * e + p.y) / e, t.z))
    lon.push(lonOf((t.x * e + p.x) / e, t.z))
    return lat.length - 1
  }

  const push = (tags: Tags, rings: P[][], polygon: boolean, e: number) => {
    const kind = classifyWay(tags)
    if (!kind) return
    const node = nodeFrom(e)
    const base = {
      kind,
      highway: tags.highway,
      walkable: isWalkable(tags),
      tunnel: isTunnel(tags),
      crossing: false,
      sub: wayStyle(kind, tags),
      ...(isBridge(tags) && (kind === 'road' || kind === 'path') ? { bridge: true } : {}),
    }
    if (polygon) {
      const [outer, ...inner] = rings
      if (!outer) return
      const clipped = clipRing(outer, e)
      if (!clipped.length) return
      const holes = inner.map((h) => clipRing(h, e)).filter((h) => h.length)
      ways.push({ id: id++, ...base, area: true, nodes: clipped.map(node), ...(holes.length ? { holes: holes.map((h) => h.map(node)) } : {}) })
      return
    }
    for (const line of rings) for (const piece of clipLine(line, e)) ways.push({ id: id++, ...base, area: false, nodes: piece.map(node) })
  }

  for (const [name, layer] of Object.entries(vt.layers)) {
    const e = layer.extent
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      const p = f.properties
      const polygon = f.type === 3
      let tags: Tags | undefined
      switch (name) {
        case 'transportation':
          tags = transportationTags(p, polygon)
          break
        case 'building':
          tags = polygon ? { building: 'yes' } : undefined
          if (polygon && !opts.coarse) for (const poly of classifyRings(f.loadGeometry())) if (poly[0]) { const r = flatRing(poly[0], e, t); if (r.length) buildingRings.push(r) }
          break
        case 'landcover':
          tags = polygon ? landcoverTags(p) : undefined
          break
        case 'landuse': {
          tags = polygon ? landuseTags(p) : undefined
          // Campus grounds (university, school, hospital): kept as areas of sights (landmarks spec, task 92).
          const gk = polygon && !opts.coarse ? groundKind(str(p.class)) : undefined
          if (gk) for (const poly of classifyRings(f.loadGeometry())) if (poly[0]) { const r = flatRing(poly[0], e, t); if (r.length) grounds.push({ kind: gk, mode: 'grounds', ring: r }) }
          break
        }
        case 'park':
          tags = polygon && p.class === 'park' ? { leisure: 'park' } : undefined
          break
        case 'water':
          tags = polygon ? waterTags(p) : undefined
          break
        case 'waterway':
          tags = f.type === 2 ? waterwayTags(p) : undefined
          break
        case 'poi': {
          if (opts.coarse || f.type !== 1) break
          const pt = poiTags(p)
          const kind = pt && landmarkKind(pt, false)
          for (const ring of f.loadGeometry()) {
            for (const q of ring) {
              if (q.x < 0 || q.y < 0 || q.x >= e || q.y >= e) continue
              const la = latOf((t.y * e + q.y) / e, t.z)
              const lo = lonOf((t.x * e + q.x) / e, t.z)
              if (kind) candidates.push({ kind, lat: la, lon: lo })
              const sight = sightFromPoi(p, la, lo)
              if (sight) sightCandidates.push(sight)
            }
          }
          break
        }
      }
      if (!tags) continue
      const geometry = f.loadGeometry()
      if (polygon) for (const poly of classifyRings(geometry)) push(tags, poly, true, e)
      else push(tags, geometry, false, e)
    }
  }
  const sights = opts.coarse ? [] : dedupeSights(sightCandidates)
  // The footprint of a sight: the building polygon that holds its point, else the nearest within reach.
  for (const s of sights) {
    if (!hasFootprint(s.kind)) continue
    let best: number[] | undefined
    let bestD = FOOTPRINT_REACH_M
    for (const ring of buildingRings) {
      const d = pointInRing(s.lat, s.lon, ring) ? 0 : distanceToRingM(s.lat, s.lon, ring)
      if (d < bestD) {
        best = ring
        bestD = d
      }
    }
    if (best) grounds.push({ kind: s.kind, mode: 'footprint', ring: best })
  }
  const data: OsmData = {
    bbox: tileBBox(t),
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    ways,
    pois: opts.coarse ? [] : dedupePois(candidates),
    sights,
    ...(grounds.length ? { grounds } : {}),
    industrial: [],
    activity: [],
    source: 'tiles',
    timestamp: '',
  }
  return data
}
