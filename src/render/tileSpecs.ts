import { Dir8, gridMask4, gridMask8, reduceMask8 } from '../tiles/autotile.ts'
import { Corner, diagonalCorners, isRoad, rampAt, rampCode, rampCovers } from '../tiles/diagonal.ts'
import { PARK_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'
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

/** Contiguous road tiles from (tx, ty) in one direction, up to `cap` (the tile itself is not counted). */
function roadRun(grid: TileGrid, tx: number, ty: number, dx: number, dy: number, cap: number): number {
  let n = 0
  while (n < cap && isRoad(grid.terrainAt(tx + dx * (n + 1), ty + dy * (n + 1)))) n++
  return n
}

/**
 * Lane marking for a road tile on a street at least 3 tiles wide: the dashed
 * line runs along the street's long axis through the middle of its width.
 * Returns 0 (none) or axis 1 east–west / 2 north–south, +4 on the far edge of
 * an even-width street, +8 for the second half of the 2-tile dash pattern.
 */
export function laneCode(grid: TileGrid, tx: number, ty: number): number {
  const n = roadRun(grid, tx, ty, 0, -1, 5)
  const s = roadRun(grid, tx, ty, 0, 1, 5)
  const w = roadRun(grid, tx, ty, -1, 0, 5)
  const e = roadRun(grid, tx, ty, 1, 0, 5)
  const vert = n + s + 1
  const horz = w + e + 1
  // The street runs along the longer extent (clearly longer, so stair-stepped diagonals get none).
  const eastWest = vert >= 3 && vert <= 9 && horz >= vert + 3
  const northSouth = horz >= 3 && horz <= 9 && vert >= horz + 3
  if (!eastWest && !northSouth) return 0
  const [a, b] = eastWest ? [n, s] : [w, e]
  const even = (a + b + 1) % 2 === 0
  // Odd width: the middle tile. Even width: the tile just before the middle, line on its far edge.
  if (even ? b !== a + 1 : a !== b) return 0
  return (eastWest ? 1 : 2) | (even ? 4 : 0) | ((eastWest ? tx : ty) % 2 ? 8 : 0)
}

/** A tile of default park grass that carries a tree (interior tile, hash picks 0 or 1). */
function hasTree(grid: TileGrid, tx: number, ty: number): boolean {
  if (grid.terrainAt(tx, ty) !== Terrain.park) return false
  if (PARK_STYLES[grid.style[grid.index(tx, ty)] ?? 0] !== 'park') return false
  return tileHash(tx, ty) % 8 <= 1 && gridMask8(grid, tx, ty) === 255
}

/** Footways in or beside parks are packed earth; every other footway is paved with flagstones. */
function pathSurface(grid: TileGrid, tx: number, ty: number): number {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid.terrainAt(tx + dx, ty + dy) === Terrain.park) return 0
  return 1
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
  const variant = tileHash(tx, ty) % 8
  // Bushes grow beside trees, so trees read as small clusters.
  const deco =
    terrain === Terrain.park && variant >= 2 && variant <= 3 && PARK_STYLES[grid.style[i] ?? 0] === 'park' && (hasTree(grid, tx - 1, ty) || hasTree(grid, tx + 1, ty) || hasTree(grid, tx, ty - 1) || hasTree(grid, tx, ty + 1))
      ? 1
      : 0
  return {
    terrain,
    m4: gridMask4(grid, tx, ty),
    m8: road ? roadMask8(grid, tx, ty) : gridMask8(grid, tx, ty),
    variant,
    vertical: terrain === Terrain.crossing ? isRoad(grid.terrainAt(tx - 1, ty)) || isRoad(grid.terrainAt(tx + 1, ty)) : false,
    style: terrain === Terrain.park ? (grid.style[i] ?? 0) : 0,
    barrier,
    bm4: barrier ? barrierMask(grid, tx, ty, barrier) : 0,
    diag: diag > 0 ? diag : 0,
    ramp: rampCode(ramp),
    lane: road && !diag && !ramp ? laneCode(grid, tx, ty) : 0,
    surface: terrain === Terrain.path ? pathSurface(grid, tx, ty) : 0,
    deco,
  }
}
