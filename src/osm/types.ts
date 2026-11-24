import type { BBox } from '../geo/geo.ts'

export type FeatureKind = 'road' | 'path' | 'building' | 'park' | 'water' | 'waterway' | 'barrier' | 'rail'

/** Order matters: the index is stored in the compact codec. Append only. */
export const FEATURE_KINDS: readonly FeatureKind[] = ['road', 'path', 'building', 'park', 'water', 'waterway', 'barrier', 'rail']

/**
 * Special buildings drawn with their own design. `greenMarket` is one supermarket
 * chain that gets a dedicated green shop design; `market` is any other supermarket.
 */
export type LandmarkKind = 'healing' | 'station' | 'school' | 'greenMarket' | 'market'

export const LANDMARK_KINDS: readonly LandmarkKind[] = ['healing', 'station', 'school', 'greenMarket', 'market']

/** A point of interest that becomes a landmark building on the map. */
export type Poi = { kind: LandmarkKind; lat: number; lon: number }

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
  /** Ring (or one arc of the ring) of a roundabout (junction=roundabout or circular); its inside is an island that is never walked across. */
  roundabout?: boolean
  /** A marked pedestrian crossing over a road (footway=crossing). */
  crossing: boolean
  /** Drawing style within the kind: park style, barrier type, building type or 'plaza'. */
  sub?: string
  /** Indices into OsmData.lat / OsmData.lon. Shared nodes connect ways. */
  nodes: number[]
  /** Street name (name=*), used for the "streets to avoid" list. */
  name?: string
  /** Safety proxies from the tags, as SAFETY_* bit flags (lighting, sidewalks, alleys…). */
  safety?: number
}

/** lit=yes (or a lit time range). */
export const SAFETY_LIT = 1
/** lit=no. */
export const SAFETY_UNLIT = 2
/** A sidewalk is mapped (sidewalk=both/left/right/yes, or footway=sidewalk). */
export const SAFETY_SIDEWALK = 4
/** A back alley, driveway or parking aisle (service=alley|driveway|parking_aisle). */
export const SAFETY_ALLEY = 8
/** Covered or underground: tunnels, underpasses, building passages, covered=yes. */
export const SAFETY_COVERED = 16

export type OsmData = {
  bbox: BBox
  lat: Float64Array
  lon: Float64Array
  ways: OsmWay[]
  /** Landmark points (supermarkets, health centres, stations, schools). */
  pois: Poi[]
  /** Industrial / railway land as closed rings of node indices (routing avoids walking through it). */
  industrial?: number[][]
  /** Shops, cafés and other places that keep a street lively, as [lat, lon, lat, lon, …]. */
  activity?: number[]
  source: 'fixture' | 'overpass'
  /** OSM base timestamp (ISO) reported by Overpass. */
  timestamp: string
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'
