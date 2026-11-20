import { haversine } from '../geo/geo.ts'
import type { Tags } from './classify.ts'
import type { LandmarkKind, Poi } from './types.ts'

/**
 * One chain gets its own green shop design (matched on OSM brand or name tags).
 * Only the tag value is checked; the name is never shown or drawn.
 */
const GREEN_MARKET = /\bmercadona\b/i
const GREEN_MARKET_WIKIDATA = 'Q377705'

const HEALTH_CENTRE_NAME = /cent(re|ro) de salu[dt]|consultori|centro sanitario|health cent(re|er)|ambulatori|hospital/i
const SCHOOLS = new Set(['school', 'college', 'university', 'kindergarten'])
const STATIONS = new Set(['station', 'halt', 'subway_entrance'])

export function isGreenMarket(tags: Tags): boolean {
  return (
    tags['brand:wikidata'] === GREEN_MARKET_WIKIDATA ||
    GREEN_MARKET.test(tags.brand ?? '') ||
    GREEN_MARKET.test(tags.name ?? '') ||
    GREEN_MARKET.test(tags.operator ?? '')
  )
}

/**
 * Map OSM tags to a landmark design, or undefined for ordinary features.
 * `polygon` is true for ways (building outlines and grounds), false for nodes.
 */
export function landmarkKind(tags: Tags, polygon = false): LandmarkKind | undefined {
  if (tags.shop === 'supermarket') return isGreenMarket(tags) ? 'greenMarket' : 'market'

  const hospital = tags.amenity === 'hospital' || tags.healthcare === 'hospital' || tags.building === 'hospital'
  if (hospital) return 'healing'
  const clinic = tags.amenity === 'clinic' || tags.healthcare === 'clinic' || tags.healthcare === 'centre'
  if (clinic) {
    // Public health centres, not every private specialist practice on a street corner.
    const speciality = tags['healthcare:speciality']
    const general = !speciality || speciality === 'general' || speciality === 'family_medicine'
    const publicCentre = tags['operator:type'] === 'public' || HEALTH_CENTRE_NAME.test(tags.name ?? '')
    if (publicCentre || (polygon && general)) return 'healing'
    return undefined
  }

  if (tags.railway && STATIONS.has(tags.railway)) return 'station'
  if (tags.public_transport === 'station' && tags.station !== 'bus' && tags.amenity !== 'bus_station') return 'station'

  if ((tags.amenity && SCHOOLS.has(tags.amenity)) || tags.building === 'school') return 'school'
  return undefined
}

/** How close two points of the same kind may be before they count as one landmark. */
export const MERGE_RADIUS_M: Record<LandmarkKind, number> = {
  healing: 80,
  station: 160,
  school: 120,
  greenMarket: 40,
  market: 40,
}

/** Drop near-duplicates (a station's many entrances, a campus of school buildings). First one wins. */
export function dedupePois(pois: readonly Poi[]): Poi[] {
  const out: Poi[] = []
  for (const p of pois) {
    const radius = MERGE_RADIUS_M[p.kind]
    if (out.some((q) => q.kind === p.kind && haversine(q, p) < radius)) continue
    out.push(p)
  }
  return out
}
