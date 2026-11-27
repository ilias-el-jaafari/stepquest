import { Layer, Terrain, type TileGrid } from '../tiles/grid.ts'
import { chunkKey } from './chunkPlan.ts'
import { forgetDecor } from '../decor/place.ts'
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

/** A changed rectangle of tiles (same shape as the streamer's). */
export type LampRect = { x: number; y: number; w: number; h: number }

/** Lamps bucketed by chunk, per grid and per chunk size (a different size never reuses another size's buckets). Each chunk is scanned on first use. */
const cache = new WeakMap<TileGrid, Map<number, Map<number, Lamp[]>>>()
/** Whether any road tile of the grid is tagged lit; it changes what counts as a lamp-worthy street. Sticky until a rectangle says otherwise. */
const anyLitCache = new WeakMap<TileGrid, boolean>()
const NONE: Lamp[] = []
/** A lamp looks at roads up to 3 tiles away along its street, and at the next tile for the kerb. */
const LAMP_REACH = 4

/**
 * Forget the lamps of a grid whose tiles changed (a streamed cell arrived or left). With the changed `rect`,
 * only the chunks within reach of it are scanned again (a lamp reads roads up to 3 tiles away), so a cell
 * arriving at the edge of a large world costs a few chunks, not the whole map. Fireflies and decor follow.
 */
export function forgetLamps(grid: TileGrid, rect?: LampRect): void {
  forgetFireflies(grid, rect)
  forgetDecor(grid, rect)
  const sizes = cache.get(grid)
  if (!sizes) return
  if (rect && anyLitCache.has(grid)) {
    // A newly lit road turns the whole-grid rule around only when none was lit before.
    if (!anyLitCache.get(grid) && rectHasLit(grid, rect)) {
      anyLitCache.delete(grid)
      cache.delete(grid)
      return
    }
    for (const [size, byChunk] of sizes) {
      const cx0 = Math.floor((rect.x - LAMP_REACH) / size)
      const cx1 = Math.floor((rect.x + rect.w - 1 + LAMP_REACH) / size)
      const cy0 = Math.floor((rect.y - LAMP_REACH) / size)
      const cy1 = Math.floor((rect.y + rect.h - 1 + LAMP_REACH) / size)
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) byChunk.delete(chunkKey(cx, cy))
    }
    return
  }
  anyLitCache.delete(grid)
  cache.delete(grid)
}

function rectHasLit(grid: TileGrid, rect: LampRect): boolean {
  const x1 = Math.min(grid.cols, rect.x + rect.w)
  const y1 = Math.min(grid.rows, rect.y + rect.h)
  for (let y = Math.max(0, rect.y); y < y1; y++) {
    for (let x = Math.max(0, rect.x); x < x1; x++) {
      const i = y * grid.cols + x
      if (((grid.layers[i] ?? 0) & Layer.lit) !== 0 && isRoad(grid.terrain[i] ?? 0)) return true
    }
  }
  return false
}

function anyLitIn(grid: TileGrid): boolean {
  let lit = anyLitCache.get(grid)
  if (lit === undefined) {
    lit = false
    for (let i = 0; i < grid.layers.length && !lit; i++) if (((grid.layers[i] ?? 0) & Layer.lit) !== 0 && isRoad(grid.terrain[i] ?? 0)) lit = true
    anyLitCache.set(grid, lit)
  }
  return lit
}

/** Lamps of one chunk (chunk of `size` tiles), found by scanning that chunk only; cached until a changed rectangle reaches it. */
export function lampsInChunk(grid: TileGrid, cx: number, cy: number, size: number): Lamp[] {
  let sizes = cache.get(grid)
  if (!sizes) cache.set(grid, (sizes = new Map()))
  let byChunk = sizes.get(size)
  if (!byChunk) sizes.set(size, (byChunk = new Map()))
  const key = chunkKey(cx, cy)
  let list = byChunk.get(key)
  if (!list) {
    list = cx < 0 || cy < 0 || cx * size >= grid.cols || cy * size >= grid.rows ? NONE : lampsInRect(grid, cx * size, cy * size, Math.min(grid.cols, (cx + 1) * size), Math.min(grid.rows, (cy + 1) * size), anyLitIn(grid))
    if (list.length === 0) list = NONE
    byChunk.set(key, list)
  }
  return list
}

/** Every lamp of the grid (tests and tools; drawing asks chunk by chunk). */
export function streetLamps(grid: TileGrid): Lamp[] {
  return lampsInRect(grid, 0, 0, grid.cols, grid.rows, anyLitIn(grid))
}

/** Lamps on the tiles x0 ≤ x < x1, y0 ≤ y < y1, in row-major order. */
function lampsInRect(grid: TileGrid, x0: number, y0: number, x1: number, y1: number, anyLit: boolean): Lamp[] {
  const { cols, rows } = grid
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && isRoad(grid.terrain[y * cols + x] ?? 0)
  const run = (x: number, y: number, dx: number, dy: number) => {
    let n = 1
    for (let k = 1; k <= 3 && road(x + dx * k, y + dy * k); k++) n++
    for (let k = 1; k <= 3 && road(x - dx * k, y - dy * k); k++) n++
    return n
  }
  const out: Lamp[] = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
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
