import { Dir8, gridMask4, gridMask8, reduceMask8 } from '../tiles/autotile.ts'
import { Corner, diagonalCorners, isRoad, rampAt, rampCode, rampCovers } from '../tiles/diagonal.ts'
import { Terrain, type TileGrid } from '../tiles/grid.ts'
import { tileHash, type TileSpec } from './tileset.ts'

/**
 * 8-bit mask for a road tile, treating a neighbour's asphalt corner that
 * covers the shared edge as road (so no kerb is drawn across the street).
 */
export function roadMask8(grid: TileGrid, tx: number, ty: number): number {
  const at = (dx: number, dy: number) => {
    const x = tx + dx
    const y = ty + dy
    if (!grid.inBounds(x, y)) return { road: true, c: 0 }
    const ramp = rampAt(grid, x, y)
    if (ramp) return { road: dx !== 0 && dy !== 0 ? true : rampCovers(ramp, -dx, -dy), c: 0 }
    const c = diagonalCorners(grid, x, y)
    return { road: isRoad(grid.terrainAt(x, y)) || c === -1, c: Math.max(0, c) }
  }
  const N = at(0, -1)
  const E = at(1, 0)
  const S = at(0, 1)
  const W = at(-1, 0)
  const NE = at(1, -1)
  const SE = at(1, 1)
  const SW = at(-1, 1)
  const NW = at(-1, -1)
  let m = 0
  if (N.road || N.c & (Corner.SE | Corner.SW)) m |= Dir8.N
  if (E.road || E.c & (Corner.SW | Corner.NW)) m |= Dir8.E
  if (S.road || S.c & (Corner.NE | Corner.NW)) m |= Dir8.S
  if (W.road || W.c & (Corner.NE | Corner.SE)) m |= Dir8.W
  if (NE.road || NE.c & Corner.SW) m |= Dir8.NE
  if (SE.road || SE.c & Corner.NW) m |= Dir8.SE
  if (SW.road || SW.c & Corner.NE) m |= Dir8.SW
  if (NW.road || NW.c & Corner.SE) m |= Dir8.NW
  return reduceMask8(m)
}

function barrierMask(grid: TileGrid, tx: number, ty: number, kind: number): number {
  const same = (x: number, y: number) => grid.inBounds(x, y) && grid.barrier[grid.index(x, y)] === kind
  return (same(tx, ty - 1) ? 1 : 0) | (same(tx + 1, ty) ? 2 : 0) | (same(tx, ty + 1) ? 4 : 0) | (same(tx - 1, ty) ? 8 : 0)
}

const BARRIER_ON = new Set<number>([Terrain.ground, Terrain.park, Terrain.plaza])

export function tileSpecAt(grid: TileGrid, tx: number, ty: number): TileSpec {
  let terrain = grid.terrainAt(tx, ty) ?? Terrain.ground
  const i = grid.index(tx, ty)
  const ramp = rampAt(grid, tx, ty)
  const diag = ramp ? 0 : diagonalCorners(grid, tx, ty)
  if (diag === -1) terrain = Terrain.road
  const road = terrain === Terrain.road
  const barrier = BARRIER_ON.has(terrain) ? (grid.barrier[i] ?? 0) : 0
  return {
    terrain,
    m4: gridMask4(grid, tx, ty),
    m8: road ? roadMask8(grid, tx, ty) : gridMask8(grid, tx, ty),
    variant: tileHash(tx, ty) % 8,
    vertical: terrain === Terrain.crossing ? isRoad(grid.terrainAt(tx - 1, ty)) || isRoad(grid.terrainAt(tx + 1, ty)) : false,
    style: terrain === Terrain.park ? (grid.style[i] ?? 0) : 0,
    barrier,
    bm4: barrier ? barrierMask(grid, tx, ty, barrier) : 0,
    diag: diag > 0 ? diag : 0,
    ramp: rampCode(ramp),
  }
}
