import { Layer, Terrain, type TileGrid } from '../tiles/grid.ts'

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

const isRoad = (t: number) => t === Terrain.road || t === Terrain.crossing

const cache = new WeakMap<TileGrid, Map<string, Lamp[]>>()

/** Lamps of one chunk (chunk of `size` tiles). */
export function lampsInChunk(grid: TileGrid, cx: number, cy: number, size: number): Lamp[] {
  let byChunk = cache.get(grid)
  if (!byChunk) {
    byChunk = bucket(streetLamps(grid), size)
    cache.set(grid, byChunk)
  }
  return byChunk.get(`${cx},${cy}`) ?? []
}

function bucket(lamps: Lamp[], size: number): Map<string, Lamp[]> {
  const map = new Map<string, Lamp[]>()
  for (const l of lamps) {
    const key = `${Math.floor(l.x / size)},${Math.floor(l.y / size)}`
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
