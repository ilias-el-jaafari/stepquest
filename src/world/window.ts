import { ZOOM_LEVELS } from '../render/camera.ts'
import { CELL_DEG } from './cells.ts'

/**
 * Most cells a quest view may touch (requirement 19.20). Equal to `MAX_CELLS_PER_MINUTE` in
 * `streamer.ts` (a test keeps them together): one minute of the request budget fills the view.
 */
export const QUEST_WINDOW_CELLS = 12

const M_PER_DEG = 111_320
/** Room for the projection's small difference from a lat/lon rectangle. */
const MARGIN = 1.02

/** The most cells a view box of this size (metres) can touch at `lat`, whatever its alignment with the cell grid. */
export function worstCellsTouched(widthM: number, heightM: number, lat: number): number {
  const cellH = CELL_DEG * M_PER_DEG
  const cellW = Math.max(1, CELL_DEG * M_PER_DEG * Math.cos((lat * Math.PI) / 180))
  const along = (extent: number, cell: number) => (extent <= 0 ? 1 : Math.ceil((extent * MARGIN) / cell) + 1)
  return along(widthM, cellW) * along(heightM, cellH)
}

/**
 * The smallest zoom (CSS px per tile) on the ladder at which a `cssW` × `cssH` view stays within
 * `QUEST_WINDOW_CELLS` cells; the top level when none does.
 */
export function questMinZoom(cssW: number, cssH: number, metresPerTile: number, lat: number, budget = QUEST_WINDOW_CELLS): number {
  if (!(cssW > 0 && cssH > 0)) return ZOOM_LEVELS[0]
  for (const z of ZOOM_LEVELS) {
    if (worstCellsTouched((cssW / z) * metresPerTile, (cssH / z) * metresPerTile, lat) <= budget) return z
  }
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!
}
