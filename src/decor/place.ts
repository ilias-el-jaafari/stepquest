import { PARK_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'

/**
 * Where the Halloween decor stands (halloween-decor spec, H3). Pure and deterministic.
 *
 * Candidate sites sit on a fixed lattice in latitude and longitude (about 5 to 6 m apart), each with a
 * hash-seeded jitter, kind and rank. A site becomes an item only when the map there is suitable (green
 * area, plaza, a lot corner, near a landmark) and every tile around it is loaded and free of streets,
 * paths and crossings. The lattice is geographic, so the same place gets the same decor on every visit,
 * whatever frame or window the grid was cut from. Placement runs once per chunk and is cached with the grid.
 */

export type DecorKind = 'pumpkin' | 'jack' | 'bat' | 'web' | 'skeleton' | 'graves' | 'crow' | 'candle' | 'lantern' | 'fog'

export type DecorItem = {
  kind: DecorKind
  /** Foot of the sprite (bottom centre) in tile units; for bats and fog the anchor of their drift. */
  x: number
  y: number
  /** The tile the item belongs to. */
  tx: number
  ty: number
  /** Which variant: web corner 0 to 3, grave shape. */
  variant: number
  /** Gravestones in the cluster (1 to 3); 1 for everything else. */
  n: number
  /** 0 to 1, stable; an item is shown when its rank is below the budget's density. */
  rank: number
  /** Only drawn at night. */
  nightOnly: boolean
  /** Drawn in the animated overlay (bats, fog, skeletons), not in the cached scene. */
  animated: boolean
  /** Position in the chunk's static list, in rank order (-1 for animated items). */
  order: number
  /** Stable 0 to 1 phase for the item's motion. */
  phase: number
}

export type ChunkDecor = {
  /** Static items in rank order. */
  statics: readonly DecorItem[]
  /** Animated items in rank order. */
  animated: readonly DecorItem[]
}

const EMPTY: ChunkDecor = { statics: [], animated: [] }

export const LAT_STEP = 0.00005
export const LON_STEP = 0.00006
/** About one site in this many is a candidate; most fail the terrain test. */
const ACCEPT = 0.55
const SEED = 0x48414c4c

export function hash3(a: number, b: number, salt: number): number {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(salt, 83492791) ^ SEED) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
const unit = (h: number): number => h / 4294967296

const PARK_OK = new Set<number>(['park', 'garden', 'grass', 'wood', 'orchard', 'cemetery'].map((n) => PARK_STYLES.indexOf(n as (typeof PARK_STYLES)[number])))
const CEMETERY = PARK_STYLES.indexOf('cemetery')

type Category = 'park' | 'cemetery' | 'plaza' | 'poi' | 'corner' | 'yard' | 'web'
type Pick = readonly (readonly [DecorKind, number])[]

/** Weights per category (the pick is by hash, so it is stable). */
const TABLE: Record<Exclude<Category, 'web'>, Pick> = {
  park: [['pumpkin', 4], ['jack', 2], ['crow', 1.5], ['candle', 1], ['graves', 1], ['bat', 2], ['fog', 2], ['skeleton', 0.3]],
  cemetery: [['graves', 6], ['candle', 2], ['crow', 2], ['skeleton', 1], ['fog', 3], ['bat', 2], ['jack', 1]],
  plaza: [['lantern', 3], ['pumpkin', 3], ['candle', 2], ['skeleton', 1.5], ['crow', 1], ['jack', 2]],
  poi: [['jack', 4], ['pumpkin', 3], ['candle', 2], ['lantern', 2]],
  corner: [['pumpkin', 3], ['lantern', 3], ['candle', 1]],
  yard: [['pumpkin', 4], ['jack', 2], ['candle', 1.5], ['lantern', 1.5], ['crow', 1], ['bat', 1.5]],
}

function pickKind(pick: Pick, h: number): DecorKind {
  let total = 0
  for (const [, w] of pick) total += w
  let r = unit(h) * total
  for (const [k, w] of pick) {
    r -= w
    if (r < 0) return k
  }
  return pick[0]![0]
}

const NIGHT_ONLY = new Set<DecorKind>(['bat', 'fog'])
const ANIMATED = new Set<DecorKind>(['bat', 'fog', 'skeleton'])

/** Whether a building-terrain tile is open yard (no house, landmark, tree, fence or gate on or just south of it). */
export type YardTest = (x: number, y: number) => boolean

const poiCache = new WeakMap<TileGrid, Set<number>>()
const cache = new WeakMap<TileGrid, Map<number, Map<number, ChunkDecor>>>()

/** Forget the placement of a grid whose tiles changed (a streamed cell arrived or left). */
export function forgetDecor(grid: TileGrid): void {
  cache.delete(grid)
  poiCache.delete(grid)
}

const POI_RADIUS = 4

/** Tiles within `POI_RADIUS` of a landmark, as row-major indices. */
function poiTiles(grid: TileGrid): Set<number> {
  let set = poiCache.get(grid)
  if (set) return set
  set = new Set()
  for (const p of grid.pois) {
    const t = grid.toTileXY(p)
    const px = Math.floor(t.x)
    const py = Math.floor(t.y)
    for (let dy = -POI_RADIUS; dy <= POI_RADIUS; dy++) {
      for (let dx = -POI_RADIUS; dx <= POI_RADIUS; dx++) {
        if (grid.inBounds(px + dx, py + dy)) set.add((py + dy) * grid.cols + px + dx)
      }
    }
  }
  poiCache.set(grid, set)
  return set
}

/** The terrain at a tile; -1 outside the grid or where a streamed world has no data yet. */
function terrainAt(grid: TileGrid, x: number, y: number): number {
  if (!grid.inBounds(x, y)) return -1
  const i = y * grid.cols + x
  if (grid.covered && !grid.covered[i]) return -1
  return grid.terrain[i] ?? -1
}

const isStreet = (t: number) => t === Terrain.road || t === Terrain.path || t === Terrain.crossing

/** Every tile in the 3×3 around (x, y) is loaded and free of streets, paths and crossings. */
export function clearOfStreets(grid: TileGrid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = terrainAt(grid, x + dx, y + dy)
      if (t < 0 || isStreet(t)) return false
    }
  }
  return true
}

/**
 * The tile and the one above it (where a sprite's head reaches) are loaded and not a street. Small still
 * items only need this, so they can stand in yards and verges right beside a road, never on it.
 */
export function tileClear(grid: TileGrid, x: number, y: number, yard?: YardTest): boolean {
  for (const dy of [0, -1]) {
    const t = terrainAt(grid, x, y + dy)
    if (t < 0 || isStreet(t)) return false
    // A house or a landmark stands on building tiles: only open yard counts.
    if (t === Terrain.building && !yard?.(x, y + dy)) return false
  }
  return true
}

/** A park tile whose style takes decor (not pitches, playgrounds or farmland). */
function parkOk(grid: TileGrid, x: number, y: number): boolean {
  return terrainAt(grid, x, y) === Terrain.park && PARK_OK.has(grid.style[y * grid.cols + x] ?? -1)
}

/** The corner (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right) where two perpendicular neighbours match, or -1. */
function cornerOf(match: (dx: number, dy: number) => boolean): number {
  const n = match(0, -1)
  const s = match(0, 1)
  const w = match(-1, 0)
  const e = match(1, 0)
  if (n && w && !s && !e) return 0
  if (n && e && !s && !w) return 1
  if (s && w && !n && !e) return 2
  if (s && e && !n && !w) return 3
  return -1
}

/** Ground with roads two tiles away on both axes: the corner of a lot at a crossing of streets. */
function streetCorner(grid: TileGrid, x: number, y: number): boolean {
  let horizontal = false
  let vertical = false
  for (const d of [-2, 2]) {
    if (isStreet(terrainAt(grid, x + d, y))) horizontal = true
    if (isStreet(terrainAt(grid, x, y + d))) vertical = true
  }
  return horizontal && vertical
}

type Site = { category: Category; web: number }

function classify(grid: TileGrid, x: number, y: number, yard?: YardTest): Site | undefined {
  const t = terrainAt(grid, x, y)
  if (t === Terrain.building) return yard?.(x, y) ? { category: 'yard', web: -1 } : undefined
  if (t === Terrain.park) {
    if (!parkOk(grid, x, y)) return undefined
    return { category: grid.style[y * grid.cols + x] === CEMETERY ? 'cemetery' : 'park', web: -1 }
  }
  if (t === Terrain.plaza) return { category: 'plaza', web: -1 }
  if (t !== Terrain.ground) return undefined
  const web = cornerOf((dx, dy) => terrainAt(grid, x + dx, y + dy) === Terrain.building)
  if (web >= 0) return { category: 'web', web }
  if (poiTiles(grid).has(y * grid.cols + x)) return { category: 'poi', web: -1 }
  if (streetCorner(grid, x, y)) return { category: 'corner', web: -1 }
  // Any other open ground: a yard, a verge or an empty lot beside the streets.
  return { category: 'yard', web: -1 }
}

/** Gravestones in a cluster need the whole 3×3 to be open green or ground (no building, no water). */
function roomForGraves(grid: TileGrid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = terrainAt(grid, x + dx, y + dy)
      if (t !== Terrain.park && t !== Terrain.ground && t !== Terrain.plaza) return false
    }
  }
  return true
}

/** Decor of one chunk of `size` tiles, in rank order. Cached per grid; the same list on every call. */
export function decorInChunk(grid: TileGrid, cx: number, cy: number, size: number, yard?: YardTest): ChunkDecor {
  let sizes = cache.get(grid)
  if (!sizes) cache.set(grid, (sizes = new Map()))
  let byChunk = sizes.get(size)
  if (!byChunk) sizes.set(size, (byChunk = new Map()))
  const key = cy * 32768 + cx
  const found = byChunk.get(key)
  if (found) return found
  const built = buildChunk(grid, cx, cy, size, yard)
  byChunk.set(key, built)
  return built
}

function buildChunk(grid: TileGrid, cx: number, cy: number, size: number, yard?: YardTest): ChunkDecor {
  const x0 = cx * size
  const y0 = cy * size
  if (x0 >= grid.cols || y0 >= grid.rows || cx < 0 || cy < 0) return EMPTY
  const x1 = Math.min(grid.cols, x0 + size)
  const y1 = Math.min(grid.rows, y0 + size)
  // Lattice range covering the chunk (corners of the chunk, padded by one node).
  const a = grid.tileToLatLon(x0, y0)
  const b = grid.tileToLatLon(x1, y1)
  const c = grid.tileToLatLon(x1, y0)
  const d = grid.tileToLatLon(x0, y1)
  const lats = [a.lat, b.lat, c.lat, d.lat]
  const lons = [a.lon, b.lon, c.lon, d.lon]
  const i0 = Math.floor(Math.min(...lats) / LAT_STEP) - 1
  const i1 = Math.ceil(Math.max(...lats) / LAT_STEP) + 1
  const j0 = Math.floor(Math.min(...lons) / LON_STEP) - 1
  const j1 = Math.ceil(Math.max(...lons) / LON_STEP) + 1
  const items: DecorItem[] = []
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const h = hash3(i, j, 1)
      if (unit(h) >= ACCEPT) continue
      // Jitter inside the lattice cell, so sites do not line up in rows.
      const jl = unit(hash3(i, j, 2))
      const jo = unit(hash3(i, j, 3))
      const t = grid.toTileXY({ lat: (i + jl) * LAT_STEP, lon: (j + jo) * LON_STEP })
      const tx = Math.floor(t.x)
      const ty = Math.floor(t.y)
      if (tx < x0 || tx >= x1 || ty < y0 || ty >= y1) continue
      if (!tileClear(grid, tx, ty, yard)) continue
      const site = classify(grid, tx, ty, yard)
      if (!site) continue
      const item = makeItem(grid, i, j, tx, ty, site)
      // Things that roam, spread, stand in groups or sit on a tile corner need the whole 3×3 free of streets.
      if (item && (item.animated || item.kind === 'graves' || item.kind === 'web') && !clearOfStreets(grid, tx, ty)) continue
      if (item) items.push(item)
    }
  }
  if (items.length === 0) return EMPTY
  items.sort((p, q) => p.rank - q.rank || p.tx - q.tx || p.ty - q.ty)
  const statics: DecorItem[] = []
  const animated: DecorItem[] = []
  for (const it of items) {
    if (it.animated) animated.push(it)
    else {
      it.order = statics.length
      statics.push(it)
    }
  }
  return { statics, animated }
}

function makeItem(grid: TileGrid, i: number, j: number, tx: number, ty: number, site: Site): DecorItem | undefined {
  const kind: DecorKind = site.category === 'web' ? 'web' : pickKind(TABLE[site.category], hash3(i, j, 4))
  if (kind === 'graves' && !roomForGraves(grid, tx, ty)) return undefined
  // Foot of the sprite, kept well inside the tile so the 3×3 clearance covers all of it.
  const fx = 0.3 + unit(hash3(i, j, 5)) * 0.4
  const fy = 0.55 + unit(hash3(i, j, 6)) * 0.4
  const web = kind === 'web'
  return {
    kind,
    x: web ? tx + (site.web & 1 ? 1 : 0) : tx + fx,
    y: web ? ty + (site.web & 2 ? 1 : 0) : ty + fy,
    tx,
    ty,
    variant: web ? site.web : Math.floor(unit(hash3(i, j, 7)) * 3),
    n: kind === 'graves' ? 1 + Math.floor(unit(hash3(i, j, 8)) * 3) : 1,
    rank: unit(hash3(i, j, 9)),
    nightOnly: NIGHT_ONLY.has(kind),
    animated: ANIMATED.has(kind),
    order: -1,
    phase: unit(hash3(i, j, 10)),
  }
}

/** Offsets (tiles, from the item's foot) of the gravestones of a cluster of up to three. */
export const GRAVE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.4, -0.1],
  [0.4, 0.05],
]
