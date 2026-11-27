import { Terrain, type TileGrid } from '../tiles/grid.ts'
import { spriteSize } from './art.ts'
import type { SightKind, SightMark } from './types.ts'

/** A sight standing on the map: the tile rectangle of its footprint (the sprite's feet are at the bottom edge, centred). */
export type PlacedSight = { mark: SightMark; kind: SightKind; x: number; y: number; w: number; h: number }

/** How far from its point (tiles) a sight may be moved to find free ground. */
export const PLACE_RADIUS = 6

/** Offsets within `PLACE_RADIUS`, nearest first (then top row, then left column), built once. */
const OFFSETS: readonly (readonly [number, number])[] = (() => {
  const list: [number, number][] = []
  for (let dy = -PLACE_RADIUS; dy <= PLACE_RADIUS; dy++) for (let dx = -PLACE_RADIUS; dx <= PLACE_RADIUS; dx++) if (Math.hypot(dx, dy) <= PLACE_RADIUS) list.push([dx, dy])
  return list.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[1] - b[1] || a[0] - b[0])
})()

/** Footprint of a kind in tiles. */
export function footprint(kind: SightKind): { w: number; h: number } {
  const s = spriteSize(kind)
  return { w: Math.ceil(s.w / 16), h: Math.ceil(s.h / 16) }
}

function free(grid: TileGrid, x: number, y: number, w: number, h: number, keep: ReadonlySet<number>, taken: ReadonlySet<number>): boolean {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (!grid.inBounds(i, j)) return false
      const k = j * grid.cols + i
      if (grid.covered && !grid.covered[k]) return false
      const t = grid.terrain[k]
      if (t === Terrain.road || t === Terrain.path || t === Terrain.crossing || t === Terrain.water) return false
      if (keep.has(k) || taken.has(k)) return false
    }
  }
  return true
}

/**
 * Stand each sight on the free spot closest to its point: loaded ground that is no street, path, crossing
 * or water, off the keep-out tiles (route, start, finish, gems) and off the sights placed before it. A sight
 * with no such spot is left out.
 */
export function placeSights(marks: readonly SightMark[], grid: TileGrid, keep: ReadonlySet<number>): PlacedSight[] {
  const taken = new Set<number>()
  const out: PlacedSight[] = []
  for (const mark of marks) {
    const t = grid.toTileXY(mark)
    const { w, h } = footprint(mark.kind)
    const cx = Math.floor(t.x) - Math.floor(w / 2)
    const cy = Math.floor(t.y) - h + 1
    for (const [dx, dy] of OFFSETS) {
      const x = cx + dx
      const y = cy + dy
      if (!free(grid, x, y, w, h, keep, taken)) continue
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) taken.add(j * grid.cols + i)
      out.push({ mark, kind: mark.kind, x, y, w, h })
      break
    }
  }
  return out
}
