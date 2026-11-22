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


/** A ramp: one tile of a gentle asphalt wedge along a shallow diagonal street. */
export interface Ramp {
  /** Side the street lies on: 0 N, 1 E, 2 S, 3 W. */
  side: number
  /** Whether the street's high end (full wedge) lies towards -x / -y. */
  highNeg: boolean
  /** Tiles in the run (2–8) and this tile's place from the high end. */
  len: number
  index: number
}

const SIDES: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]
const MAX_RUN = 8

/**
 * Where a shallow street steps by one tile every few tiles, the plain
 * 45° corners leave long flat runs between the steps. This finds the run of
 * open tiles along the street's edge that sits between a step up (street
 * tile at one end) and a step down (open, then street, at the other end) and
 * returns this tile's share of one long wedge, so the kerb runs straight
 * from step to step. Null when the tile is not in such a run.
 */
export function rampAt(grid: TileGrid, tx: number, ty: number): Ramp | null {
  const soft = (x: number, y: number) => {
    const t = grid.terrainAt(x, y)
    return t !== undefined && SOFT.has(t)
  }
  const road = (x: number, y: number) => isRoad(grid.terrainAt(x, y))
  if (!soft(tx, ty) || diagonalCorners(grid, tx, ty) === -1) return null
  for (let side = 0; side < 4; side++) {
    const [rx, ry] = SIDES[side]!
    if (!road(tx + rx, ty + ry)) continue
    // Run direction: perpendicular to the street side.
    const ax = ry === 0 ? 0 : 1
    const ay = ry === 0 ? 1 : 0
    const inRun = (k: number) => soft(tx + k * ax, ty + k * ay) && road(tx + k * ax + rx, ty + k * ay + ry)
    let lo = 0
    while (lo > -MAX_RUN && inRun(lo - 1)) lo--
    let hi = 0
    while (hi < MAX_RUN && inRun(hi + 1)) hi++
    const len = hi - lo + 1
    if (len < 2 || len > MAX_RUN) continue
    const high = (k: number) => road(tx + k * ax, ty + k * ay)
    const low = (k: number) => {
      const x = tx + k * ax
      const y = ty + k * ay
      return soft(x, y) && soft(x + rx, y + ry) && road(x + 2 * rx, y + 2 * ry)
    }
    if (high(lo - 1) && low(hi + 1)) return { side, highNeg: true, len, index: lo === 0 ? 0 : -lo }
    if (high(hi + 1) && low(lo - 1)) return { side, highNeg: false, len, index: hi }
  }
  return null
}

/** Compact number for a ramp (0 = none), for tile keys. */
export function rampCode(r: Ramp | null): number {
  return r ? 1 + r.side + 4 * (r.highNeg ? 1 : 0) + 8 * r.len + 128 * r.index : 0
}

export function decodeRamp(code: number): Ramp | null {
  if (!code) return null
  const c = code - 1
  return { side: c & 3, highNeg: (c & 4) !== 0, len: (c >> 3) & 15, index: c >> 7 }
}

/**
 * Whether a ramp tile's wedge covers its whole edge towards (dx, dy): the
 * street side always, and the high end for the first tile of the run.
 */
export function rampCovers(r: Ramp, dx: number, dy: number): boolean {
  const [rx, ry] = SIDES[r.side]!
  if (dx === rx && dy === ry) return true
  if (r.index !== 0) return false
  const ax = ry === 0 ? 0 : 1
  const ay = ry === 0 ? 1 : 0
  const s = r.highNeg ? -1 : 1
  return dx === s * ax && dy === s * ay
}
