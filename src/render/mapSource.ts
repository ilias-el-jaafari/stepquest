import type { TileGrid, TileRect } from '../tiles/grid.ts'
import { layoutLookup, type TownLookup } from '../town/lookup.ts'
import { townFor } from '../town/layout.ts'

/**
 * One straight edge of loaded map beside ground with no data. `x`, `y` are the tile corner where the
 * edge starts and `len` its length in tiles; `side` is the direction of the missing data (the loaded
 * side is the opposite one): `n` is a horizontal edge with nothing above it, `w` a vertical edge with
 * nothing to its left.
 */
export type FrontierEdge = { side: 'n' | 's' | 'e' | 'w'; x: number; y: number; len: number }

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
  /** Edges where loaded map meets ground with no data; the renderer fades them (requirement 19.21). Optional: a single extract has none. */
  frontier?(): readonly FrontierEdge[]
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
