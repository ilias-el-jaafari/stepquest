import type { FeatureKind } from './types.ts'

export type Tags = Record<string, string | undefined>

const ROAD_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'service', 'busway', 'road',
])
const PATH_HIGHWAYS = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'track', 'bridleway'])
const NEVER_WALK = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'busway'])
const FOOT_YES = new Set(['yes', 'designated', 'permissive', 'official'])
const PARK_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'dog_park', 'common', 'recreation_ground'])
const PARK_LANDUSE = new Set([
  'grass', 'recreation_ground', 'meadow', 'farmland', 'orchard', 'forest', 'village_green', 'allotments', 'cemetery',
])
const PARK_NATURAL = new Set(['wood', 'scrub', 'grassland', 'heath'])
const WATERWAYS = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'riverbank'])

/** Map raw OSM tags to the layer we draw, or undefined when we ignore the way. */
/** Track types drawn as rails and never walked on. */
const RAIL_TRACKS = new Set(['tram', 'light_rail', 'rail', 'subway', 'narrow_gauge'])

/** A tram, metro or train track (whether above ground or not). */
export function isRailTrack(tags: Tags): boolean {
  return tags.railway !== undefined && RAIL_TRACKS.has(tags.railway)
}

/** Underground track: tunnel=yes/building_passage… (a cutting with tunnel=no stays visible). */
function isUndergroundTrack(tags: Tags): boolean {
  if (tags.tunnel !== undefined) return tags.tunnel !== 'no'
  return Number(tags.layer ?? 0) < 0
}

export function classifyWay(tags: Tags): FeatureKind | undefined {
  // Tracks win over any highway tag: they are drawn as rails and are never walkable.
  if (isRailTrack(tags)) return isUndergroundTrack(tags) ? undefined : 'rail'
  const hw = tags.highway
  if (hw) {
    if (ROAD_HIGHWAYS.has(hw)) return 'road'
    if (PATH_HIGHWAYS.has(hw)) return 'path'
    return undefined // construction, proposed, elevator, platform, corridor…
  }
  if (tags.building && tags.building !== 'no') return 'building'
  if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'water'
  if (tags.waterway && WATERWAYS.has(tags.waterway)) return tags.waterway === 'riverbank' ? 'water' : 'waterway'
  if (tags.place === 'square') return 'path'
  if (tags.leisure && PARK_LEISURE.has(tags.leisure)) return 'park'
  if (tags.landuse && PARK_LANDUSE.has(tags.landuse)) return 'park'
  if (tags.natural && PARK_NATURAL.has(tags.natural)) return 'park'
  if (tags.barrier && BARRIERS.has(tags.barrier)) return 'barrier'
  return undefined
}

const BARRIERS = new Set(['fence', 'hedge', 'wall'])

/** Park styles drawn differently (tall grass, flower gardens, sports pitches, woods…). */
export type ParkStyle = 'park' | 'garden' | 'grass' | 'pitch' | 'playground' | 'wood' | 'farmland' | 'orchard' | 'cemetery'

export function parkStyle(tags: Tags): ParkStyle {
  switch (tags.leisure) {
    case 'garden':
      return 'garden'
    case 'pitch':
      return 'pitch'
    case 'playground':
      return 'playground'
  }
  switch (tags.landuse) {
    case 'grass':
    case 'meadow':
    case 'village_green':
      return 'grass'
    case 'farmland':
    case 'allotments':
      return 'farmland'
    case 'orchard':
      return 'orchard'
    case 'forest':
      return 'wood'
    case 'cemetery':
      return 'cemetery'
  }
  if (tags.natural === 'wood' || tags.natural === 'scrub') return 'wood'
  if (tags.natural === 'grassland' || tags.natural === 'heath') return 'grass'
  return 'park'
}

/** Extra drawing detail for a way (see OsmWay.sub). */
export function wayStyle(kind: FeatureKind, tags: Tags): string | undefined {
  switch (kind) {
    case 'park':
      return parkStyle(tags)
    case 'barrier':
      return tags.barrier
    case 'path':
      return tags.place === 'square' || (tags.highway === 'pedestrian' && tags.area === 'yes') ? 'plaza' : undefined
    case 'building': {
      const b = tags.building
      if (b === 'industrial' || b === 'warehouse' || b === 'barn' || b === 'greenhouse' || b === 'roof') return 'industrial'
      if (b === 'house' || b === 'detached' || b === 'semidetached_house' || b === 'terrace' || b === 'bungalow') return 'house'
      return undefined
    }
    default:
      return undefined
  }
}

/** Whether a pedestrian may legally walk along the way. */
export function isWalkable(tags: Tags): boolean {
  const hw = tags.highway
  if (!hw || isRailTrack(tags)) return false
  if (!ROAD_HIGHWAYS.has(hw) && !PATH_HIGHWAYS.has(hw)) return false
  const foot = tags.foot
  if (foot && FOOT_YES.has(foot)) return true
  if (foot === 'no' || foot === 'use_sidepath' || foot === 'private') return false
  if (tags.access === 'no' || tags.access === 'private') return false
  if (NEVER_WALK.has(hw)) return false
  // Spanish cycle lanes are not for walking unless tagged so.
  if (hw === 'cycleway') return false
  return true
}

/** Whether a closed way should be filled as a polygon. */
export function isArea(kind: FeatureKind, tags: Tags, closed: boolean): boolean {
  if (!closed) return false
  if (kind === 'road' || kind === 'path') return tags.area === 'yes' || tags.place === 'square'
  return kind !== 'waterway' && kind !== 'barrier' && kind !== 'rail'
}

/** junction=roundabout or junction=circular (a closed ring around an island). */
export function isRoundaboutTag(tags: Tags): boolean {
  return tags.junction === 'roundabout' || tags.junction === 'circular'
}

/** Footway segments that cross a carriageway (drawn as zebra crossings). */
export function isCrossing(tags: Tags): boolean {
  return tags.footway === 'crossing' || tags.highway === 'crossing' || (tags.crossing !== undefined && tags.crossing !== 'no' && tags.highway !== undefined && tags.highway !== 'cycleway')
}

export function isTunnel(tags: Tags): boolean {
  return (tags.tunnel !== undefined && tags.tunnel !== 'no') || Number(tags.layer ?? 0) < 0
}

const ALLEY_SERVICE = new Set(['alley', 'driveway', 'parking_aisle', 'drive-through'])
const LIVELY_AMENITY = new Set([
  'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'pharmacy', 'bank', 'ice_cream', 'library', 'police',
  'marketplace', 'community_centre', 'theatre', 'cinema',
])
const INDUSTRIAL_LANDUSE = new Set(['industrial', 'railway', 'construction', 'brownfield', 'depot'])

/** Safety proxy flags (SAFETY_* in types.ts) for a walkable way. */
export function safetyFlags(tags: Tags): number {
  let f = 0
  const lit = tags.lit
  if (lit === 'no' || lit === 'disused') f |= 2
  else if (lit && lit !== 'unknown') f |= 1 // yes, 24/7, automatic, sunset-sunrise, limited…
  const sw = tags.sidewalk ?? tags['sidewalk:both'] ?? tags['sidewalk:left'] ?? tags['sidewalk:right']
  if ((sw && sw !== 'no' && sw !== 'none' && sw !== 'separate') || tags.footway === 'sidewalk') f |= 4
  if (tags.highway === 'service' && tags.service && ALLEY_SERVICE.has(tags.service)) f |= 8
  if (isTunnel(tags) || tags.covered === 'yes' || tags.tunnel === 'building_passage' || tags.indoor === 'yes') f |= 16
  return f
}

/** Whether a node or building makes the street around it lively (shops, cafés, bars…). */
export function isLively(tags: Tags): boolean {
  return (tags.shop !== undefined && tags.shop !== 'vacant' && tags.shop !== 'no') || (tags.amenity !== undefined && LIVELY_AMENITY.has(tags.amenity))
}

/** Industrial or railway land, which is empty and badly lit at night. */
export function isIndustrialLand(tags: Tags): boolean {
  return tags.landuse !== undefined && INDUSTRIAL_LANDUSE.has(tags.landuse)
}
