import type { BBox } from '../geo/geo.ts'
import { classifyWay, isArea, isBridge, isCrossing, isIndustrialLand, isLively, isRoundaboutTag, isTunnel, isWalkable, safetyFlags, wayStyle, type Tags } from './classify.ts'
import { dedupePois, landmarkKind } from './landmarks.ts'
import { dedupeSights, sightFromTags } from '../sights/classify.ts'
import type { Sight } from '../sights/types.ts'
import { assembleRings, buildPolygons, type Ring } from './multipolygon.ts'
import type { OsmData, OsmWay, Poi } from './types.ts'

export type OverpassWay = {
  type: 'way'
  id: number
  tags?: Tags
  nodes?: number[]
  geometry?: ({ lat: number; lon: number } | null)[]
}

export type OverpassNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }

/** A relation member as `out geom` prints it: coordinates, no node ids. */
export type OverpassMember = { type: string; ref?: number; role?: string; geometry?: ({ lat: number; lon: number } | null)[] }

export type OverpassResponse = {
  elements?: ({ type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; members?: OverpassMember[] } & Partial<Omit<OverpassWay, 'type'>>)[]
  osm3s?: { timestamp_osm_base?: string }
  remark?: string
}

/**
 * Turn an Overpass `out geom` response into our compact model. Node ids are
 * shared between ways so the routing graph knows where streets meet.
 */
export function normalizeOverpass(json: OverpassResponse, bbox: BBox, source: OsmData['source'] = 'overpass'): OsmData {
  const index = new Map<number, number>()
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = []
  // Landmark candidates, ranked so outlines beat points and stations beat their entrances.
  const candidates: { poi: Poi; rank: number }[] = []
  const sights: Sight[] = []
  const industrial: number[][] = []
  const activity: number[] = []
  const inBox = (p: { lat: number; lon: number }) => p.lat >= bbox.south && p.lat <= bbox.north && p.lon >= bbox.west && p.lon <= bbox.east

  const elements = Array.isArray(json.elements) ? json.elements : []
  // Outer ways of a multipolygon relation that are also tagged themselves (old-style
  // mapping) would fill the relation's holes again: the relation wins.
  const claimed = new Set<string>()
  for (const element of elements) {
    if (!element || element.type !== 'relation' || element.tags?.type !== 'multipolygon') continue
    const kind = classifyWay(element.tags)
    if (kind !== 'building' && kind !== 'park' && kind !== 'water') continue
    for (const m of element.members ?? []) if (m.type === 'way' && m.role === 'outer' && m.ref !== undefined) claimed.add(`${kind}:${m.ref}`)
  }
  const coordIndex = new Map<string, number>()
  const nodeAt = (p: { lat: number; lon: number }) => {
    const k = `${p.lat},${p.lon}`
    let at = coordIndex.get(k)
    if (at === undefined) {
      at = lat.length
      coordIndex.set(k, at)
      lat.push(p.lat)
      lon.push(p.lon)
    }
    return at
  }
  const ringNodes = (ring: Ring) => ring.map(nodeAt)

  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    if (element.type === 'node') {
      const tags = element.tags ?? {}
      if (isLively(tags) && typeof element.lat === 'number' && typeof element.lon === 'number' && inBox({ lat: element.lat, lon: element.lon })) {
        activity.push(round6(element.lat), round6(element.lon))
      }
      if (typeof element.lat === 'number' && typeof element.lon === 'number' && inBox({ lat: element.lat, lon: element.lon })) {
        const sight = sightFromTags(tags, element.lat, element.lon)
        if (sight) sights.push(sight)
      }
      const kind = landmarkKind(tags, false)
      if (kind && typeof element.lat === 'number' && typeof element.lon === 'number' && inBox({ lat: element.lat, lon: element.lon })) {
        candidates.push({ poi: { kind, lat: element.lat, lon: element.lon }, rank: tags.railway === 'subway_entrance' ? 2 : 1 })
      }
      continue
    }
    if (element.type === 'relation') {
      // Multipolygon hospitals and stations: only their centre is used (needs `out center`).
      const kind = landmarkKind(element.tags ?? {}, true)
      if (kind && element.center && inBox(element.center)) candidates.push({ poi: { kind, ...element.center }, rank: 0 })
      const sight = element.center && inBox(element.center) ? sightFromTags(element.tags ?? {}, element.center.lat, element.center.lon) : undefined
      if (sight) sights.push(sight)
      const tags = element.tags ?? {}
      const areaKind = tags.type === 'multipolygon' ? classifyWay(tags) : undefined
      if (areaKind === 'building' || areaKind === 'park' || areaKind === 'water') {
        const outerSegments: Ring[] = []
        const innerSegments: Ring[] = []
        for (const m of element.members ?? []) {
          if (m.type !== 'way' || !Array.isArray(m.geometry)) continue
          // A member with a gap (a node outside the query) cannot be closed: keep only whole members.
          if (!m.geometry.every(validPoint)) continue
          if (m.role === 'outer') outerSegments.push(m.geometry as Ring)
          else if (m.role === 'inner') innerSegments.push(m.geometry as Ring)
        }
        for (const { outer, holes } of buildPolygons(assembleRings(outerSegments), assembleRings(innerSegments))) {
          const nodes = ringNodes(outer)
          if (distinctCount(nodes) < 3) continue
          const holeRings = holes.map(ringNodes).filter((h) => distinctCount(h) >= 3)
          ways.push({
            id: element.id ?? 0,
            kind: areaKind,
            walkable: false,
            area: true,
            tunnel: isTunnel(tags),
            crossing: false,
            sub: wayStyle(areaKind, tags),
            nodes,
            ...(holeRings.length ? { holes: holeRings } : {}),
          })
        }
      }
      continue
    }
    if (element.type !== 'way') continue
    const way = element as OverpassWay
    const tags = way.tags ?? {}
    const landmark = landmarkKind(tags, true)
    if (landmark) {
      const centre = element.center ?? centroid(way.geometry)
      if (centre && inBox(centre)) candidates.push({ poi: { kind: landmark, ...centre }, rank: 0 })
    }
    {
      const centre = element.center ?? centroid(way.geometry)
      const sight = centre && inBox(centre) ? sightFromTags(tags, centre.lat, centre.lon) : undefined
      if (sight) sights.push(sight)
    }
    if (isLively(tags) && !tags.highway) {
      const centre = element.center ?? centroid(way.geometry)
      if (centre && inBox(centre)) activity.push(round6(centre.lat), round6(centre.lon))
    }
    const industrialLand = isIndustrialLand(tags)
    const kind = classifyWay(tags)
    if ((!kind && !industrialLand) || !Array.isArray(way.nodes) || !Array.isArray(way.geometry) || way.nodes.length < 2) continue
    if (kind && claimed.has(`${kind}:${way.id}`)) continue
    // A node without geometry lies outside the query box. Split the way there:
    // joining its neighbours would draw (and route) a chord across the gap.
    const runs: number[][] = [[]]
    for (let i = 0; i < way.nodes.length; i++) {
      const id = way.nodes[i]
      const point = way.geometry[i]
      if (id === undefined || !validPoint(point)) {
        if (runs[runs.length - 1]!.length) runs.push([])
        continue
      }
      let at = index.get(id)
      if (at === undefined) {
        at = lat.length
        index.set(id, at)
        lat.push(point.lat)
        lon.push(point.lon)
      }
      const run = runs[runs.length - 1]!
      if (run[run.length - 1] !== at) run.push(at)
    }
    // Polygons clipped by the box keep the old behaviour (one ring, closed by the clip).
    const isLine = kind === 'road' || kind === 'path' || kind === 'waterway' || kind === 'barrier' || kind === 'rail'
    if (!isLine && runs.length > 1) {
      const merged: number[] = []
      for (const r of runs) for (const n of r) if (merged[merged.length - 1] !== n) merged.push(n)
      runs.splice(0, runs.length, merged)
    }
    const closed = runs.length === 1 && way.nodes[0] === way.nodes[way.nodes.length - 1]
    const walkable = kind ? isWalkable(tags) : false
    for (const nodes of runs) {
      if (nodes.length < 2) continue
      if (industrialLand && closed && nodes.length >= 4) industrial.push(nodes)
      if (!kind) continue
      const area = isArea(kind, tags, closed)
      // A polygon needs three different corners; two points and back is a line, not a building.
      if ((area || kind === 'building' || kind === 'park' || kind === 'water') && distinctCount(nodes) < 3) continue
      ways.push({
        id: way.id,
        kind,
        highway: tags.highway,
        walkable,
        area,
        tunnel: isTunnel(tags),
        ...(isBridge(tags) && (kind === 'road' || kind === 'path') ? { bridge: true } : {}),
        crossing: kind === 'path' && isCrossing(tags),
        ...(kind === 'road' && isRoundaboutTag(tags) ? { roundabout: true } : {}),
        sub: wayStyle(kind, tags),
        nodes,
        ...(walkable && tags.name ? { name: tags.name } : {}),
        ...(walkable ? { safety: safetyFlags(tags) } : {}),
      })
    }
  }
  candidates.sort((a, b) => a.rank - b.rank)
  const pois = dedupePois(candidates.map((c) => c.poi))
  const dedupedSights = dedupeSights(sights)

  return {
    bbox,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    ways,
    pois,
    ...(dedupedSights.length ? { sights: dedupedSights } : {}),
    industrial,
    activity,
    source,
    timestamp: json.osm3s?.timestamp_osm_base ?? '',
  }
}

function distinctCount(nodes: readonly number[]): number {
  return new Set(nodes).size
}

function centroid(geometry: OverpassWay['geometry']): { lat: number; lon: number } | undefined {
  let lat = 0
  let lon = 0
  let n = 0
  for (const p of geometry ?? []) {
    if (!p) continue
    lat += p.lat
    lon += p.lon
    n++
  }
  return n ? { lat: lat / n, lon: lon / n } : undefined
}

/** A usable coordinate: finite and inside the valid range (a null, NaN or 1e9 means "no point"). */
export function validPoint(p: { lat: number; lon: number } | null | undefined): p is { lat: number; lon: number } {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6
