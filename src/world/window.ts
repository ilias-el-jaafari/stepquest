import { FAR_ZOOM, ZOOM_LEVELS } from '../render/camera.ts'
import { COARSE_Z, DETAIL_Z } from '../vector/assemble.ts'
import { tileSizeM } from '../vector/tileMath.ts'
import { CELL_DEG } from './cells.ts'
import { MAX_RADIUS_CELLS } from './tileWorld.ts'

/**
 * Most vector tiles a quest view may touch (requirement 21.11, which replaces 19.20 and 20.13): at or
 * below `FAR_ZOOM` coarse tiles (z12, about 7.5 km), above it detail tiles (z14, about 1.9 km).
 */
export const QUEST_WINDOW_TILES = 6
/** Cells the frame spans on each axis: a view wider or taller than this cannot be drawn whole. */
export const FRAME_CELLS = 2 * MAX_RADIUS_CELLS + 1

const M_PER_DEG = 111_320
/** Room for the projection's small difference from a lat/lon rectangle. */
const MARGIN = 1.02

const along = (extent: number, unit: number) => (extent <= 0 ? 1 : Math.ceil((extent * MARGIN) / Math.max(1, unit)) + 1)

/** The most cells a view box of this size (metres) can touch at `lat`, per axis, whatever its alignment with the cell grid. */
export function worstCellsAlong(widthM: number, heightM: number, lat: number): { w: number; h: number } {
  return { w: along(widthM, CELL_DEG * M_PER_DEG * Math.cos((lat * Math.PI) / 180)), h: along(heightM, CELL_DEG * M_PER_DEG) }
}

/** The most cells a view box of this size can touch. */
export function worstCellsTouched(widthM: number, heightM: number, lat: number): number {
  const a = worstCellsAlong(widthM, heightM, lat)
  return a.w * a.h
}

/** The most vector tiles of zoom `z` a view box of this size can touch at `lat` (Mercator tiles are square on the ground). */
export function worstTilesTouched(widthM: number, heightM: number, lat: number, z: number): number {
  const size = tileSizeM(z, lat)
  return along(widthM, size) * along(heightM, size)
}

/**
 * The smallest zoom (CSS px per tile) on the ladder at which a `cssW` × `cssH` quest view stays
 * drawable: it touches at most `budget` tiles of the layer that zoom draws from, and fits in the frame
 * (at most `FRAME_CELLS` cells per axis). The top level when none does.
 */
export function questMinZoom(cssW: number, cssH: number, metresPerTile: number, lat: number, budget = QUEST_WINDOW_TILES): number {
  if (!(cssW > 0 && cssH > 0)) return ZOOM_LEVELS[0]
  for (const z of ZOOM_LEVELS) {
    const w = (cssW / z) * metresPerTile
    const h = (cssH / z) * metresPerTile
    const cells = worstCellsAlong(w, h, lat)
    if (cells.w > FRAME_CELLS || cells.h > FRAME_CELLS) continue
    if (worstTilesTouched(w, h, lat, z <= FAR_ZOOM ? COARSE_Z : DETAIL_Z) <= budget) return z
  }
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!
}
