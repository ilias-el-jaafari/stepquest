import { bboxContains, haversine, type BBox, type LatLon } from '../geo/geo.ts'

/** Wait this long after the map stops moving before asking for data. */
export const AUTO_LOAD_SETTLE_MS = 1200
/** After a failed attempt, do not ask again for a view this close to it. */
export const RETRY_RADIUS_M = 500

export type AutoLoadInput = {
  bbox: BBox
  /** Map centre after the last pan or zoom. */
  centre: LatLon | undefined
  /** A download is running. */
  busy: boolean
  /** A route is planned or a quest runs: replacing the map would throw it away. */
  hasPlan: boolean
  /** The last view centre that already failed to load. */
  failedAt: LatLon | undefined
}

/**
 * Load the area under the view automatically when the user rests the map outside
 * the loaded area and nothing would be lost. Otherwise the "Load this area" button stays.
 */
export function shouldAutoLoad(i: AutoLoadInput): boolean {
  if (!i.centre || i.busy || i.hasPlan) return false
  if (bboxContains(i.bbox, i.centre)) return false
  if (i.failedAt && haversine(i.failedAt, i.centre) < RETRY_RADIUS_M) return false
  return true
}
