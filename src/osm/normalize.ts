import type { BBox } from '../geo/geo.ts'
import { classifyWay, isArea, isCrossing, isIndustrialLand, isLively, isRoundaboutTag, isTunnel, isWalkable, safetyFlags, wayStyle, type Tags } from './classify.ts'
import { dedupePois, landmarkKind } from './landmarks.ts'
import type { OsmData, OsmWay, Poi } from './types.ts'

export type OverpassWay = {
  type: 'way'
  id: number
  tags?: Tags
  nodes?: number[]
  geometry?: ({ lat: number; lon: number } | null)[]
}

export type OverpassNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }

export type OverpassResponse = {
  elements?: ({ type: string; lat?: number; lon?: number; center?: { lat: number; lon: number } } & Partial<Omit<OverpassWay, 'type'>>)[]
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
  const industrial: number[][] = []
  const activity: number[] = []
  const inBox = (p: { lat: number; lon: number }) => p.lat >= bbox.south && p.lat <= bbox.north && p.lon >= bbox.west && p.lon <= bbox.east

  for (const element of json.elements ?? []) {
    if (element.type === 'node') {
      const tags = element.tags ?? {}
      if (isLively(tags) && typeof element.lat === 'number' && typeof element.lon === 'number' && inBox({ lat: element.lat, lon: element.lon })) {
        activity.push(round6(element.lat), round6(element.lon))
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
    if (isLively(tags) && !tags.highway) {
      const centre = element.center ?? centroid(way.geometry)
      if (centre && inBox(centre)) activity.push(round6(centre.lat), round6(centre.lon))
    }
    const industrialLand = isIndustrialLand(tags)
    const kind = classifyWay(tags)
    if ((!kind && !industrialLand) || !way.nodes || !way.geometry || way.nodes.length < 2) continue
    // A node without geometry lies outside the query box. Split the way there:
    // joining its neighbours would draw (and route) a chord across the gap.
    const runs: number[][] = [[]]
    for (let i = 0; i < way.nodes.length; i++) {
      const id = way.nodes[i]
      const point = way.geometry[i]
      if (id === undefined || !point) {
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
      ways.push({
        id: way.id,
        kind,
        highway: tags.highway,
        walkable,
        area: isArea(kind, tags, closed),
        tunnel: isTunnel(tags),
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

  return {
    bbox,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    ways,
    pois,
    industrial,
    activity,
    source,
    timestamp: json.osm3s?.timestamp_osm_base ?? '',
  }
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

const round6 = (v: number) => Math.round(v * 1e6) / 1e6
