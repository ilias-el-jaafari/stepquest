import { Terrain, type TerrainId, type TileGrid } from './grid.ts'

/** 4-bit cardinal mask: which neighbours continue the same terrain. */
export const Dir4 = { N: 1, E: 2, S: 4, W: 8 } as const
/** 8-bit mask, clockwise from north. */
export const Dir8 = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 } as const

/** Which terrains count as "the same" when connecting edges. */
export function connects(self: TerrainId, other: TerrainId | undefined): boolean {
  if (other === undefined) return true // the map edge never draws a border
  if (self === other) return true
  // Zebra crossings continue both the road and the footway they join.
  if (other === Terrain.crossing) return self === Terrain.road || self === Terrain.path
  if (self === Terrain.crossing) return other === Terrain.road || other === Terrain.path
  // Footways run up to the kerb, so a path reaches into a neighbouring road
  // (one-way: the road still draws its kerb on that side).
  if (self === Terrain.path) return other === Terrain.road
  return false
}

type Lookup = (tx: number, ty: number) => TerrainId | undefined

function lookup(grid: TileGrid): Lookup {
  return (tx, ty) => grid.terrainAt(tx, ty)
}

export function mask4At(at: Lookup, tx: number, ty: number): number {
  const self = at(tx, ty)
  if (self === undefined) return 0
  let m = 0
  if (connects(self, at(tx, ty - 1))) m |= Dir4.N
  if (connects(self, at(tx + 1, ty))) m |= Dir4.E
  if (connects(self, at(tx, ty + 1))) m |= Dir4.S
  if (connects(self, at(tx - 1, ty))) m |= Dir4.W
  return m
}

export function mask8At(at: Lookup, tx: number, ty: number): number {
  const self = at(tx, ty)
  if (self === undefined) return 0
  const same = (dx: number, dy: number) => connects(self, at(tx + dx, ty + dy))
  let m = 0
  if (same(0, -1)) m |= Dir8.N
  if (same(1, -1)) m |= Dir8.NE
  if (same(1, 0)) m |= Dir8.E
  if (same(1, 1)) m |= Dir8.SE
  if (same(0, 1)) m |= Dir8.S
  if (same(-1, 1)) m |= Dir8.SW
  if (same(-1, 0)) m |= Dir8.W
  if (same(-1, -1)) m |= Dir8.NW
  return reduceMask8(m)
}

/**
 * Classic "blob" reduction: a diagonal only matters when both cardinals next
 * to it connect. This folds 256 raw masks into the 47 tiles artists draw.
 */
export function reduceMask8(mask: number): number {
  let m = mask & 0xff
  const n = m & Dir8.N
  const e = m & Dir8.E
  const s = m & Dir8.S
  const w = m & Dir8.W
  if (!(n && e)) m &= ~Dir8.NE
  if (!(s && e)) m &= ~Dir8.SE
  if (!(s && w)) m &= ~Dir8.SW
  if (!(n && w)) m &= ~Dir8.NW
  return m
}

/** The 47 reduced masks in ascending order; index = tile number in a blob tileset. */
export const BLOB_MASKS: readonly number[] = (() => {
  const set = new Set<number>()
  for (let m = 0; m < 256; m++) set.add(reduceMask8(m))
  return [...set].sort((a, b) => a - b)
})()

const BLOB_INDEX = new Map(BLOB_MASKS.map((mask, i) => [mask, i]))

export function blobIndex(mask: number): number {
  return BLOB_INDEX.get(reduceMask8(mask)) ?? 0
}

export function gridMask4(grid: TileGrid, tx: number, ty: number): number {
  return mask4At(lookup(grid), tx, ty)
}

export function gridMask8(grid: TileGrid, tx: number, ty: number): number {
  return mask8At(lookup(grid), tx, ty)
}

/** Shape name for a 4-bit mask, handy for debugging and tests. */
export function shape4(mask: number): 'isolated' | 'end' | 'straight' | 'corner' | 'tee' | 'cross' {
  const bits = [Dir4.N, Dir4.E, Dir4.S, Dir4.W].filter((b) => mask & b).length
  if (bits === 0) return 'isolated'
  if (bits === 1) return 'end'
  if (bits === 2) return mask === (Dir4.N | Dir4.S) || mask === (Dir4.E | Dir4.W) ? 'straight' : 'corner'
  if (bits === 3) return 'tee'
  return 'cross'
}
