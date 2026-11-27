import type { BBox, LatLon } from '../geo/geo.ts'
import { haversine } from '../geo/geo.ts'
import { DETAIL_ZOOM, FAR_ZOOM } from '../render/camera.ts'
import { Street } from './classes.ts'
import { tileBBox, tileKey, tileSizeM, tilesInBBox, type TileId } from '../vector/tileMath.ts'

/** The zoom of the vector tiles the LOD look is made from: the most detailed OpenFreeMap serves (requirement 25.1). */
export const LOD_Z = 14

/** How a tile is drawn now: tile art (close), LOD blocks and lines (far, near the hero), coarse layer (far, away from the hero). */
export type LodLook = 'art' | 'blocks' | 'coarse'

/** The look of a tile `distanceM` from the hero at `zoom` (CSS px per tile), with detail radius `radiusM` (requirement 25.1). */
export function lodLook(distanceM: number, zoom: number, radiusM: number): LodLook {
  if (zoom > FAR_ZOOM) return 'art'
  return distanceM <= radiusM ? 'blocks' : 'coarse'
}

/** Metres from `p` to the nearest point of the tile's box (0 inside it). */
export function distanceToTileM(t: TileId, p: LatLon): number {
  const b = tileBBox(t)
  const q = { lat: Math.min(b.north, Math.max(b.south, p.lat)), lon: Math.min(b.east, Math.max(b.west, p.lon)) }
  return haversine(p, q)
}

/** Bitmap sizes per tile side, in device px (requirement 25.4). */
export const LOD_LEVELS = [256, 384, 512, 768, 1024] as const
export type LodLevel = (typeof LOD_LEVELS)[number]

/** The smallest level that is at least `devPx` wide, else the biggest. */
export function bitmapLevel(devPx: number): LodLevel {
  for (const l of LOD_LEVELS) if (l >= devPx) return l
  return LOD_LEVELS[LOD_LEVELS.length - 1]!
}

export type TileAt = { id: TileId; distM: number }

/** The z14 tiles within `radiusM` of `hero`, nearest first (ties by row, then column): the order of the rings (requirement 25.8). */
export function tilesWithin(hero: LatLon, radiusM: number): TileAt[] {
  const dLat = radiusM / 111_320
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos((hero.lat * Math.PI) / 180)))
  const box: BBox = { south: hero.lat - dLat, north: hero.lat + dLat, west: hero.lon - dLon, east: hero.lon + dLon }
  const out: TileAt[] = []
  for (const id of tilesInBBox(box, LOD_Z)) {
    const distM = distanceToTileM(id, hero)
    if (distM <= radiusM) out.push({ id, distM })
  }
  return out.sort((a, b) => a.distM - b.distM || a.id.y - b.id.y || a.id.x - b.id.x)
}

/** The tiles a view box meets, nearest the view centre first. */
export function tilesInView(box: BBox, centre: LatLon): TileAt[] {
  return tilesInBBox(box, LOD_Z)
    .map((id) => ({ id, distM: distanceToTileM(id, centre) }))
    .sort((a, b) => a.distM - b.distM || a.id.y - b.id.y || a.id.x - b.id.x)
}

/** Ground size of one LOD tile at `lat`, metres. */
export const lodTileSizeM = (lat: number): number => tileSizeM(LOD_Z, lat)

/** The lowest zoom (CSS px per tile) at which a street of this class is labelled (requirement 25.6). */
export function labelMinZoom(cls: number): number {
  if (cls >= Street.secondary && cls <= Street.motorway) return 0.5
  if (cls === Street.tertiary) return 0.75
  return FAR_ZOOM
}

/** Labels are drawn below this zoom: from `DETAIL_ZOOM` on the tile art is drawn, with its own street names left to the player's eyes. */
export const LABEL_MAX_ZOOM = DETAIL_ZOOM

export { tileKey }
