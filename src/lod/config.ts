/** The detail radius around the hero, in metres (requirement 25): every z14 tile within it is drawn in full at the far zooms. */
export const DEFAULT_LOD_RADIUS_M = 10_000
export const MIN_LOD_RADIUS_M = 2_000
export const MAX_LOD_RADIUS_M = 15_000

/** Clamp a radius to what the app supports (NaN gives the default). */
export function clampRadius(m: number): number {
  if (!Number.isFinite(m)) return DEFAULT_LOD_RADIUS_M
  return Math.min(MAX_LOD_RADIUS_M, Math.max(MIN_LOD_RADIUS_M, Math.round(m)))
}

/** The radius from `?lod=<km>` in a query string (screenshots, field tests), else the default. */
export function lodRadiusFrom(search: string | undefined): number {
  const raw = new URLSearchParams(search ?? '').get('lod')
  if (raw === null || raw.trim() === '') return DEFAULT_LOD_RADIUS_M
  return clampRadius(Number(raw) * 1000)
}

/** The camera can go at least this far from the hero in the planner and in a quest (requirement 26.1): the far-pick distance. */
export const R_FAR_M = 10_000
/** How far from the hero the camera is stopped: `R_FAR_M` plus the width of a street pick and a margin. */
export const PAN_REACH_M = 12_000
/** Around a focus point (the tapped finish, a place the view rested at) every z14 tile within this radius gets the full detail (requirement 26.3). */
export const FOCUS_RADIUS_M = 2_500
/** Focus points kept from the view (the older ones are forgotten), besides the finish. */
export const MAX_VIEW_FOCUS = 2
/** Focus tiles loaded in a session, apart from the ring cap of requirement 25.8. */
export const FOCUS_MAX_TILES = 120
