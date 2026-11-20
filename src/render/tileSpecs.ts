import { gridMask4, gridMask8 } from '../tiles/autotile.ts'
import { Terrain, type TileGrid } from '../tiles/grid.ts'
import { tileHash, type TileSpec } from './tileset.ts'

/**
 * Label each connected building block so a whole block shares one roof colour
 * (per-tile colours would look like a patchwork).
 */
export function roofColours(grid: TileGrid, palette = 5): Uint8Array {
  const out = new Uint8Array(grid.cols * grid.rows)
  const seen = new Uint8Array(grid.cols * grid.rows)
  const stack: number[] = []
  for (let i = 0; i < out.length; i++) {
    if (seen[i] || grid.terrain[i] !== Terrain.building) continue
    const colour = tileHash(i % grid.cols, Math.floor(i / grid.cols)) % palette
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      out[j] = colour
      const x = j % grid.cols
      const y = (j - x) / grid.cols
      const nbrs = [x > 0 ? j - 1 : -1, x < grid.cols - 1 ? j + 1 : -1, y > 0 ? j - grid.cols : -1, y < grid.rows - 1 ? j + grid.cols : -1]
      for (const k of nbrs) {
        if (k >= 0 && !seen[k] && grid.terrain[k] === Terrain.building) {
          seen[k] = 1
          stack.push(k)
        }
      }
    }
  }
  return out
}

export function tileSpecAt(grid: TileGrid, roofs: Uint8Array, tx: number, ty: number): TileSpec {
  const terrain = grid.terrainAt(tx, ty) ?? Terrain.ground
  const isRoad = (x: number, y: number) => {
    const t = grid.terrainAt(x, y)
    return t === Terrain.road
  }
  return {
    terrain,
    m4: gridMask4(grid, tx, ty),
    m8: gridMask8(grid, tx, ty),
    variant: tileHash(tx, ty) % 8,
    roof: roofs[grid.index(tx, ty)] ?? 0,
    vertical: terrain === Terrain.crossing ? isRoad(tx - 1, ty) || isRoad(tx + 1, ty) : false,
  }
}
