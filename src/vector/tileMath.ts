import type { BBox } from '../geo/geo.ts'

/**
 * Web Mercator tile maths for the vector tiles (requirement 21). Pure. A tile is named by its zoom
 * and integer column and row; its edges are a meridian and a parallel, so two neighbours share an
 * edge exactly when both compute it from the same integers (`lonOf` and `latOf` below).
 */
export type TileId = { z: number; x: number; y: number }

/** Mercator stops here; tiles beyond do not exist. */
export const MAX_MERCATOR_LAT = 85.0511287798

export const tileKey = (t: TileId): string => `${t.z}/${t.x}/${t.y}`

/** Longitude of the tile column edge `x` (a fraction is a point inside the tile). */
export function lonOf(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

/** Latitude of the tile row edge `y` (a fraction is a point inside the tile). */
export function latOf(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z)
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI
}

/** Fractional tile coordinates of a point. */
export function tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const la = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n }
}

export function tileBBox(t: TileId): BBox {
  return { west: lonOf(t.x, t.z), east: lonOf(t.x + 1, t.z), north: latOf(t.y, t.z), south: latOf(t.y + 1, t.z) }
}

/** Tiles of zoom `z` whose area meets the box, west to east, north to south. */
export function tilesInBBox(b: BBox, z: number): TileId[] {
  if (![b.south, b.west, b.north, b.east].every(Number.isFinite) || b.south > b.north || b.west > b.east) return []
  const n = 2 ** z
  const a = tileXY(b.north, b.west, z)
  const c = tileXY(b.south, b.east, z)
  const eps = 1e-9
  const x0 = Math.max(0, Math.floor(a.x + eps))
  const x1 = Math.min(n - 1, Math.max(x0, Math.ceil(c.x - eps) - 1))
  const y0 = Math.max(0, Math.floor(a.y + eps))
  const y1 = Math.min(n - 1, Math.max(y0, Math.ceil(c.y - eps) - 1))
  const out: TileId[] = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y })
  return out
}

/** Ground width (and height, Mercator tiles are square on the ground) of a tile at `lat`, metres. */
export function tileSizeM(z: number, lat: number): number {
  return (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}
