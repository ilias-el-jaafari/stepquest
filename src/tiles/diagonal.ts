import { Terrain, type TerrainId, type TileGrid } from './grid.ts'

/** Corner bits for diagonal street smoothing: NE 1, SE 2, SW 4, NW 8. */
export const Corner = { NE: 1, SE: 2, SW: 4, NW: 8 } as const

export const isRoad = (t: TerrainId | undefined) => t === Terrain.road || t === Terrain.crossing

/** Terrains that can take an asphalt corner to smooth a diagonal street. */
const SOFT = new Set<number>([Terrain.ground, Terrain.park, Terrain.building, Terrain.plaza])

/**
 * Corners of a non-road tile that sit in the step of a diagonal street:
 * both cardinal neighbours of the corner (and the diagonal one) are road.
 * Returns -1 when the tile is so surrounded by road it should just be road.
 */
export function diagonalCorners(grid: TileGrid, tx: number, ty: number): number {
  const t = grid.terrainAt(tx, ty)
  if (t === undefined || !SOFT.has(t)) return 0
  const n = isRoad(grid.terrainAt(tx, ty - 1))
  const e = isRoad(grid.terrainAt(tx + 1, ty))
  const s = isRoad(grid.terrainAt(tx, ty + 1))
  const w = isRoad(grid.terrainAt(tx - 1, ty))
  const roads = Number(n) + Number(e) + Number(s) + Number(w)
  if (roads >= 3) return -1
  let c = 0
  if (n && e && isRoad(grid.terrainAt(tx + 1, ty - 1))) c |= Corner.NE
  if (s && e && isRoad(grid.terrainAt(tx + 1, ty + 1))) c |= Corner.SE
  if (s && w && isRoad(grid.terrainAt(tx - 1, ty + 1))) c |= Corner.SW
  if (n && w && isRoad(grid.terrainAt(tx - 1, ty - 1))) c |= Corner.NW
  return c
}

