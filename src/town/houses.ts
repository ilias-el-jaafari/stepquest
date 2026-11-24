import { diagonalCorners, rampAt } from '../tiles/diagonal.ts'
import { BUILDING_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'
import { analyseBlocks, largestRect, subdivide } from './blocks.ts'
import { hash2, rng } from './random.ts'
import { ROOF_COLOURS, WALL_COLOURS, type House, type HouseKind, type Rect } from './types.ts'

/**
 * House placement: every block (see `blocks.ts`) is cut into lots, and each
 * lot gets up to three houses, a front yard (fence and gate) or side garden
 * when there is room, and trees on the tiles left over.
 *
 * Guarantees, for any grid (tested as properties): a house only covers
 * building tiles that no landmark or gate has reserved, houses never overlap,
 * and the result depends only on the grid, not on any input order.
 */

export type HousePlacement = {
  houses: House[]
  /** Tile → house index, or -1. */
  houseAt: Int32Array
  trees: Set<number>
  fences: Set<number>
  gates: Set<number>
}

/** Houses per lot: odd-shaped lots (diagonal blocks) are filled piece by piece. */
const MAX_HOUSES_PER_LOT = 3

/** Pick a house style from its size and the tagged building type. */
export function houseKind(w: number, h: number, buildingStyle: string): HouseKind {
  if (buildingStyle === 'industrial') return 'warehouse'
  if (buildingStyle === 'house') return 'house'
  return w * h >= 30 || h >= 5 ? 'apartments' : 'house'
}

/** The most common building style among the tiles of a rectangle (ties: the first style in `BUILDING_STYLES`). */
function dominantStyle(grid: TileGrid, x: number, y: number, w: number, h: number): string {
  const counts = new Array<number>(BUILDING_STYLES.length).fill(0)
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const s = grid.style[grid.index(xx, yy)] ?? 0
      counts[s < counts.length ? s : 0]!++
    }
  return BUILDING_STYLES[counts.indexOf(Math.max(...counts))] ?? 'block'
}

/** Place houses on every block of building tiles outside `reserved`. */
export function placeHouses(grid: TileGrid, reserved: Uint8Array): HousePlacement {
  const houses: House[] = []
  const houseAt = new Int32Array(grid.cols * grid.rows).fill(-1)
  const trees = new Set<number>()
  const fences = new Set<number>()
  const gates = new Set<number>()
  const { blocks, owner } = analyseBlocks(grid, reserved)
  blocks.forEach((block, b) => {
    const id = b + 1
    const inBlock = (i: number) => owner[i] === id
    const random = rng(block.seed)
    for (const lot of subdivide(block.bounds, random)) {
      const mask = new Uint8Array(lot.w * lot.h)
      // Tiles cut by a diagonal street corner or ramp stay garden so the smooth kerb shows.
      for (let y = 0; y < lot.h; y++)
        for (let x = 0; x < lot.w; x++)
          mask[y * lot.w + x] = inBlock(grid.index(lot.x + x, lot.y + y)) && diagonalCorners(grid, lot.x + x, lot.y + y) === 0 && !rampAt(grid, lot.x + x, lot.y + y) ? 1 : 0
      for (let k = 0; k < MAX_HOUSES_PER_LOT; k++) {
        const r = largestRect(mask, lot.w, lot.h)
        if (!r || r.h < 2 || r.w < 2 || r.w * r.h < 4) break
        for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) mask[yy * lot.w + xx] = 0
        let { w, h } = r
        const x = lot.x + r.x
        const y = lot.y + r.y
        // A front garden on taller plots; a side garden on some wide ones.
        const frontYard = h >= 6 || (h >= 5 && random() < 0.5)
        if (frontYard) h -= 1
        if (w >= 7 && random() < 0.4) w -= 1
        const kind = houseKind(w, h, dominantStyle(grid, x, y, w, h))
        const seed = hash2(x, y)
        const door = w <= 2 ? 0 : w === 3 ? 1 : 1 + (seed % (w - 2))
        const index = houses.length
        houses.push({ x, y, w, h, kind, roof: seed % ROOF_COLOURS, wall: (seed >>> 8) % WALL_COLOURS, door, seed, frontYard })
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) houseAt[grid.index(xx, yy)] = index
        if (frontYard) {
          const fy = y + h
          for (let xx = x; xx < x + r.w; xx++) {
            const i = grid.index(xx, fy)
            if (!inBlock(i)) continue
            // Fence only along a street-facing edge; a gate below the door.
            const open = grid.terrainAt(xx, fy + 1) !== Terrain.building
            if (xx === x + door) gates.add(i)
            else if (open) fences.add(i)
          }
        }
      }
      scatterTrees(grid, inBlock, lot, trees, random, houseAt, fences, gates)
    }
  })
  return { houses, houseAt, trees, fences, gates }
}

/**
 * Scatter trees on the lot tiles no house uses (back gardens, leftovers). The
 * tile right under a house stays clear, and so do fence and gate tiles (a
 * side-garden lot can have a fence tile with no house above it). Random draws
 * are made for the same tiles whether or not a tree is allowed, so the rest of
 * the lot looks the same.
 */
function scatterTrees(grid: TileGrid, inBlock: (i: number) => boolean, lot: Rect, trees: Set<number>, random: () => number, houseAt: Int32Array, fences: Set<number>, gates: Set<number>) {
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      const i = grid.index(x, y)
      if (!inBlock(i) || (houseAt[i] ?? -1) >= 0 || gates.has(i)) continue
      const aboveHouse = y > 0 && (houseAt[i - grid.cols] ?? -1) >= 0
      if (!aboveHouse && random() < 0.18 && !fences.has(i)) trees.add(i)
    }
  }
}
