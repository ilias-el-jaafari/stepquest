import type { OsmWay } from './types.ts'

/**
 * The coarse layer (requirement 21.4): what the far zooms need to look like a map: streets cars and
 * walkers use, big green and blue areas, rivers and rail. No buildings, no barriers, no paths, no
 * points of interest, no lawns or small gardens (a lawn is a third of the points of a city extract
 * and is not visible at 1 px per tile). Applied to the low-zoom vector tiles.
 */
const COARSE_HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'

const COARSE_ROADS = new Set(COARSE_HIGHWAYS.split('|'))

/** Whether a normalized way belongs to the coarse layer. */
export function isCoarseWay(w: OsmWay): boolean {
  switch (w.kind) {
    case 'road':
      return !!w.highway && COARSE_ROADS.has(w.highway)
    case 'park':
      return w.sub !== 'garden' && w.sub !== 'pitch' && w.sub !== 'playground' && w.sub !== 'grass'
    case 'water':
    case 'waterway':
    case 'rail':
      return true
    default:
      return false
  }
}

