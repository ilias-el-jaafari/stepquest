import { PARK_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'
import { chunkKey } from './chunkPlan.ts'

/**
 * Fireflies: tiny glints over park-like tiles at night (requirement 22.6). Positions come from a
 * hash of the tile, so they are the same every frame, pan and reload. Pure; drawing is in
 * `lightingLayer.ts`.
 */

export const MAX_FIREFLIES_PER_CHUNK = 6
/** About one eligible tile in this many holds a firefly. */
const ONE_IN = 40
export const FIREFLY_BLINK_MS = 2600

export type Firefly = { x: number; y: number; phase: number }

const LEAFY = new Set<number>(['park', 'garden', 'grass', 'wood', 'orchard'].map((n) => PARK_STYLES.indexOf(n as (typeof PARK_STYLES)[number])))

const cache = new WeakMap<TileGrid, Map<number, Map<number, Firefly[]>>>()
const NONE: Firefly[] = []

/** Forget the fireflies of a grid whose tiles changed: those of the chunks touching `rect`, or all without one. */
export function forgetFireflies(grid: TileGrid, rect?: { x: number; y: number; w: number; h: number }): void {
  const sizes = cache.get(grid)
  if (!sizes) return
  if (!rect) {
    cache.delete(grid)
    return
  }
  for (const [size, byChunk] of sizes) {
    for (let cy = Math.floor(rect.y / size); cy <= Math.floor((rect.y + rect.h - 1) / size); cy++) {
      for (let cx = Math.floor(rect.x / size); cx <= Math.floor((rect.x + rect.w - 1) / size); cx++) byChunk.delete(chunkKey(cx, cy))
    }
  }
}

function hash(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

/** Fireflies of one chunk of `size` tiles (cached per grid and size). `x`, `y` are in tiles, inside the tile. */
export function firefliesInChunk(grid: TileGrid, cx: number, cy: number, size: number): Firefly[] {
  let sizes = cache.get(grid)
  if (!sizes) cache.set(grid, (sizes = new Map()))
  let byChunk = sizes.get(size)
  if (!byChunk) sizes.set(size, (byChunk = new Map()))
  const key = chunkKey(cx, cy)
  let list = byChunk.get(key)
  if (list) return list
  const found: Firefly[] = []
  const x1 = Math.min(grid.cols, (cx + 1) * size)
  const y1 = Math.min(grid.rows, (cy + 1) * size)
  for (let y = Math.max(0, cy * size); y < y1; y++) {
    for (let x = Math.max(0, cx * size); x < x1; x++) {
      const i = y * grid.cols + x
      if (grid.terrain[i] !== Terrain.park || !LEAFY.has(grid.style[i] ?? -1)) continue
      const h = hash(x, y, 1)
      if (h % ONE_IN !== 0) continue
      const o = hash(x, y, 2)
      found.push({ x: x + 0.1 + ((o & 255) / 255) * 0.8, y: y + 0.1 + (((o >>> 8) & 255) / 255) * 0.8, phase: ((o >>> 16) & 1023) / 1023 })
    }
  }
  // Even subset, so the cap never favours the top of the chunk.
  if (found.length > MAX_FIREFLIES_PER_CHUNK) {
    const kept: Firefly[] = []
    for (let k = 0; k < MAX_FIREFLIES_PER_CHUNK; k++) kept.push(found[Math.floor((k * found.length) / MAX_FIREFLIES_PER_CHUNK)]!)
    list = kept
  } else list = found.length ? found : NONE
  byChunk.set(key, list)
  return list
}

/** Blink strength 0 to 1 at time `now`; steady and dim (0.5) with reduced motion. */
export function fireflyLevel(f: Firefly, now: number, reduced: boolean): number {
  if (reduced) return 0.5
  const wave = Math.sin(2 * Math.PI * (now / FIREFLY_BLINK_MS + f.phase))
  return Math.max(0, wave) // dark half of the time
}
