import type { BBox } from '../geo/geo.ts'

export type FeatureKind = 'road' | 'path' | 'building' | 'park' | 'water' | 'waterway'

export const FEATURE_KINDS: readonly FeatureKind[] = ['road', 'path', 'building', 'park', 'water', 'waterway']

export type OsmWay = {
  id: number
  kind: FeatureKind
  /** OSM highway=* value for roads and paths. */
  highway?: string
  /** Pedestrians may walk along it (used to build the routing graph). */
  walkable: boolean
  /** Closed polygon (building, park, water, pedestrian square) rather than a line. */
  area: boolean
  /** Underground (tunnel=yes); drawn as nothing but still routable when walkable. */
  tunnel: boolean
  /** A marked pedestrian crossing over a road (footway=crossing). */
  crossing: boolean
  /** Indices into OsmData.lat / OsmData.lon. Shared nodes connect ways. */
  nodes: number[]
}

export type OsmData = {
  bbox: BBox
  lat: Float64Array
  lon: Float64Array
  ways: OsmWay[]
  source: 'fixture' | 'overpass'
  /** OSM base timestamp (ISO) reported by Overpass. */
  timestamp: string
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'
