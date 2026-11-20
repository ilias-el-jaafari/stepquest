import type { BBox } from '../geo/geo.ts'
import { classifyWay, isArea, isCrossing, isTunnel, isWalkable, type Tags } from './classify.ts'
import type { OsmData, OsmWay } from './types.ts'

export type OverpassWay = {
  type: 'way'
  id: number
  tags?: Tags
  nodes?: number[]
  geometry?: ({ lat: number; lon: number } | null)[]
}

export type OverpassResponse = {
  elements?: ({ type: string } & Partial<Omit<OverpassWay, 'type'>>)[]
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

  for (const element of json.elements ?? []) {
    if (element.type !== 'way') continue
    const way = element as OverpassWay
    const tags = way.tags ?? {}
    const kind = classifyWay(tags)
    if (!kind || !way.nodes || !way.geometry || way.nodes.length < 2) continue
    const nodes: number[] = []
    for (let i = 0; i < way.nodes.length; i++) {
      const id = way.nodes[i]
      const point = way.geometry[i]
      if (id === undefined || !point) continue
      let at = index.get(id)
      if (at === undefined) {
        at = lat.length
        index.set(id, at)
        lat.push(point.lat)
        lon.push(point.lon)
      }
      if (nodes[nodes.length - 1] !== at) nodes.push(at)
    }
    if (nodes.length < 2) continue
    const closed = way.nodes[0] === way.nodes[way.nodes.length - 1]
    ways.push({
      id: way.id,
      kind,
      highway: tags.highway,
      walkable: isWalkable(tags),
      area: isArea(kind, tags, closed),
      tunnel: isTunnel(tags),
      crossing: kind === 'path' && isCrossing(tags),
      nodes,
    })
  }

  return {
    bbox,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    ways,
    source,
    timestamp: json.osm3s?.timestamp_osm_base ?? '',
  }
}
