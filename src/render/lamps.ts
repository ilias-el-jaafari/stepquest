import { Layer, Terrain, type TileGrid } from '../tiles/grid.ts'
import { chunkKey } from './chunkPlan.ts'
import { forgetFireflies } from './fireflies.ts'

/**
 * Street lamp positions, derived from the tile grid (deterministic, so nothing
 * moves when panning). The map data carries no lamp nodes, so lamps stand on
 * the kerbs of lit streets (`lit=*`, drawn as Layer.lit). Streets without any
 * lighting tag get lamps only when they are wide (main avenues, presumed lit,
 * as routing assumes); when no street in the area is tagged at all, every
 * street at least 2 tiles wide counts.
 */

export const LAMP_SPACING = 6
export type Lamp = { x: number; y: number }

/** Cost caps (requirement 22.4): lamps drawn per chunk and per frame. */
export const MAX_LAMPS_PER_CHUNK = 12
export const MAX_LAMPS_PER_FRAME = 1500
/** Flicker steps (ms) and depth (requirement 22.5). */
export const FLICKER_MS = 500
export const FLICKER_DEPTH = 0.08

/** At most `cap` items, evenly spaced through the list (the same subset every call; the list itself when it fits). */
export function evenSubset<T>(list: readonly T[], cap: number): readonly T[] {
  if (list.length <= cap) return list
  const out: T[] = []
  for (let i = 0; i < cap; i++) out.push(list[Math.floor((i * list.length) / cap)]!)
  return out
}

/** Pool strength factor of a lamp at time `now`: 1 with reduced motion, else 1 - up to 8 % from a hash of the lamp and the step. */
export function flicker(lamp: Lamp, now: number, reduced: boolean): number {
  if (reduced) return 1
  let h = (Math.imul(lamp.x, 73856093) ^ Math.imul(lamp.y, 19349663) ^ Math.imul(Math.floor(now / FLICKER_MS), 83492791)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  return 1 - FLICKER_DEPTH * ((h % 1000) / 999)
}

const isRoad = (t: number) => t === Terrain.road || t === Terrain.crossing

const lampsByGrid = new WeakMap<TileGrid, Lamp[]>()
/** Lamps bucketed by chunk, per grid and per chunk size (a different size never reuses another size's buckets). */
const cache = new WeakMap<TileGrid, Map<number, Map<number, Lamp[]>>>()
const NONE: Lamp[] = []

/** Forget the lamps of a grid whose tiles changed (a streamed cell arrived or left). */
export function forgetLamps(grid: TileGrid): void {
  lampsByGrid.delete(grid)
  cache.delete(grid)
  forgetFireflies(grid)
}

/** Lamps of one chunk (chunk of `size` tiles). Allocation-free after the first call for a grid and size. */
export function lampsInChunk(grid: TileGrid, cx: number, cy: number, size: number): Lamp[] {
  let sizes = cache.get(grid)
  if (!sizes) cache.set(grid, (sizes = new Map()))
  let byChunk = sizes.get(size)
  if (!byChunk) {
    let all = lampsByGrid.get(grid)
    if (!all) lampsByGrid.set(grid, (all = streetLamps(grid)))
    sizes.set(size, (byChunk = bucket(all, size)))
  }
  return byChunk.get(chunkKey(cx, cy)) ?? NONE
}

function bucket(lamps: Lamp[], size: number): Map<number, Lamp[]> {
  const map = new Map<number, Lamp[]>()
  for (const l of lamps) {
    const key = chunkKey(Math.floor(l.x / size), Math.floor(l.y / size))
    const list = map.get(key)
    if (list) list.push(l)
    else map.set(key, [l])
  }
  return map
}

export function streetLamps(grid: TileGrid): Lamp[] {
  const { cols, rows } = grid
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && isRoad(grid.terrain[y * cols + x] ?? 0)
  let anyLit = false
  for (let i = 0; i < grid.layers.length && !anyLit; i++) if (((grid.layers[i] ?? 0) & Layer.lit) !== 0 && isRoad(grid.terrain[i] ?? 0)) anyLit = true
  const run = (x: number, y: number, dx: number, dy: number) => {
    let n = 1
    for (let k = 1; k <= 3 && road(x + dx * k, y + dy * k); k++) n++
    for (let k = 1; k <= 3 && road(x - dx * k, y - dy * k); k++) n++
    return n
  }
  const out: Lamp[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!road(x, y)) continue
      const north = !road(x, y - 1)
      const south = !road(x, y + 1)
      const west = !road(x - 1, y)
      const east = !road(x + 1, y)
      if (!(north || south || west || east)) continue
      // Which kerb orientation this tile is on decides the lattice: alternate sides along a street.
      const horizontal = north || south
      const phase = horizontal ? (x + (north ? 0 : LAMP_SPACING)) % (LAMP_SPACING * 2) : (y + (west ? 0 : LAMP_SPACING)) % (LAMP_SPACING * 2)
      if (phase !== 0) continue
      const width = Math.min(run(x, y, 1, 0), run(x, y, 0, 1))
      const lit = ((grid.layers[y * cols + x] ?? 0) & Layer.lit) !== 0
      if (lit || width >= 3 || (!anyLit && width >= 2)) out.push({ x, y })
    }
  }
  return out
}
