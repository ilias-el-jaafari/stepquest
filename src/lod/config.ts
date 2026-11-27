/** The detail radius around the hero, in metres (requirement 25): every z14 tile within it is drawn in full at the far zooms. */
export const DEFAULT_LOD_RADIUS_M = 9_000
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
