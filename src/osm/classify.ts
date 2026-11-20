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
export function classifyWay(tags: Tags): FeatureKind | undefined {
  const hw = tags.highway
  if (hw) {
    if (ROAD_HIGHWAYS.has(hw)) return 'road'
    if (PATH_HIGHWAYS.has(hw)) return 'path'
    return undefined // construction, proposed, elevator, platform, corridor…
  }
  if (tags.building && tags.building !== 'no') return 'building'
  if (tags.natural === 'water' || tags.water || tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'water'
  if (tags.waterway && WATERWAYS.has(tags.waterway)) return tags.waterway === 'riverbank' ? 'water' : 'waterway'
  if (tags.leisure && PARK_LEISURE.has(tags.leisure)) return 'park'
  if (tags.landuse && PARK_LANDUSE.has(tags.landuse)) return 'park'
  if (tags.natural && PARK_NATURAL.has(tags.natural)) return 'park'
  return undefined
}

/** Whether a pedestrian may legally walk along the way. */
export function isWalkable(tags: Tags): boolean {
  const hw = tags.highway
  if (!hw) return false
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
  if (kind === 'road' || kind === 'path') return tags.area === 'yes'
  return kind !== 'waterway'
}

/** Footway segments that cross a carriageway (drawn as zebra crossings). */
export function isCrossing(tags: Tags): boolean {
  return tags.footway === 'crossing' || tags.highway === 'crossing' || (tags.crossing !== undefined && tags.crossing !== 'no' && tags.highway !== undefined && tags.highway !== 'cycleway')
}

export function isTunnel(tags: Tags): boolean {
  return (tags.tunnel !== undefined && tags.tunnel !== 'no') || Number(tags.layer ?? 0) < 0
}
