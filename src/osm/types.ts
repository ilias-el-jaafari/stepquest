import type { BBox } from '../geo/geo.ts'
import type { Ground, Sight } from '../sights/types.ts'

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
  /** On a bridge or viaduct (bridge=*): painted over water and over tracks, which pass underneath. Absent in data built before codec v4. */
  bridge?: boolean
  /**
   * Inner rings of a multipolygon (courtyards, ponds): closed rings of node
   * indices that are cut out of this way's polygon. Only on `area` ways.
   */
  holes?: number[][]
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
  /**
   * Vector-tile buildings only: the point that decides which cell builds the building's houses (the
   * centre of the box of all its pieces across tile seams, requirement 21.6). Absent: the centre of
   * this way's own box. Not stored by the codec (tile data is grouped again when it is assembled).
   */
  anchor?: { lat: number; lon: number }
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
  /** Sights (faculties, schools, hospitals, places of worship, the town hall, monuments; landmarks spec). Absent in data built before codec v5. */
  sights?: Sight[]
  /** Real areas of sights: campus grounds and building footprints (landmarks spec, task 92). Absent in data built before codec v6. */
  grounds?: Ground[]
  /** Industrial / railway land as closed rings of node indices (routing avoids walking through it). */
  industrial?: number[][]
  /** Shops, cafés and other places that keep a street lively, as [lat, lon, lat, lon, …]. */
  activity?: number[]
  /**
   * The parts of `bbox` that are actually loaded (one box per cell of a streamed world). Absent for a
   * single extract, where the whole `bbox` is loaded. The walking graph only uses points inside it.
   */
  coverage?: BBox[]
  /** Where the data came from: the bundled extract, Overpass (walking graph), or vector tiles (drawing only). */
  source: 'fixture' | 'overpass' | 'tiles'
  /** OSM base timestamp (ISO) reported by Overpass. */
  timestamp: string
}

/**
 * The full credit shown on the map (requirement 21.12): the tile service, the tile schema and the
 * data, each linked by the map view (openfreemap.org, openmaptiles.org, openstreetmap.org/copyright).
 * The Spanish form is `map.creditTiles` + `map.creditSchema` + `map.attribution` in `es.ts`.
 */
export const OSM_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles © OpenStreetMap contributors'
