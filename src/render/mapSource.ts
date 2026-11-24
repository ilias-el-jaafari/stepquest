import type { TileGrid, TileRect } from '../tiles/grid.ts'
import { layoutLookup, type TownLookup } from '../town/lookup.ts'
import { townFor } from '../town/layout.ts'

/**
 * What the renderer draws: a tile grid, its town, the rectangles still loading (drawn with the
 * loading stipple) and change notices. A single extract is a static source; a streamed world
 * (`world/liveWorld.ts`) grows and tells the renderer which tiles to repaint.
 */
export interface MapSource {
  readonly grid: TileGrid
  readonly town: TownLookup
  /** Tile rectangles of cells that are wanted but not loaded yet. */
  loading(): readonly TileRect[]
  /** `rect` changed (a cell arrived or left), or with no rect only the loading set changed. Returns the unsubscribe. */
  subscribe(fn: (rect: TileRect | undefined) => void): () => void
}

const sources = new WeakMap<TileGrid, MapSource>()
const NONE: readonly TileRect[] = []

/** The source of a single extract: everything loaded, nothing ever changes. */
export function staticSource(grid: TileGrid): MapSource {
  let s = sources.get(grid)
  if (!s) {
    const town = layoutLookup(townFor(grid))
    s = { grid, town, loading: () => NONE, subscribe: () => () => undefined }
    sources.set(grid, s)
  }
  return s
}

export const isMapSource = (x: TileGrid | MapSource): x is MapSource => 'town' in x && 'subscribe' in x
