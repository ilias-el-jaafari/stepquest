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

export type DecorKind = 'pumpkin' | 'jack' | 'bat' | 'web' | 'skeleton' | 'graves' | 'crow' | 'candle' | 'lantern' | 'fog' | 'scarecrow' | 'cauldron' | 'sign' | 'fence' | 'spider'

export type DecorItem = {
  kind: DecorKind
  /** Foot of the sprite (bottom centre) in tile units; for bats and fog the anchor of their drift. */
  x: number
  y: number
  /** The tile the item belongs to. */
  tx: number
  ty: number
  /** Which variant: web corner 0 to 3, grave shape, pumpkin with a small one on the right (1) or left (2). */
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

export const LAT_STEP = 0.000036
export const LON_STEP = 0.000044
/** About this share of the sites is a candidate; most fail the terrain test. */
const ACCEPT = 0.8
/** Two sites closer than this (metres) never both stand: the lower rank wins, decided from the hashes alone so it holds in every frame. */
const MIN_GAP_M = 3.8
const M_PER_DEG = 111_320
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
const WOOD = PARK_STYLES.indexOf('wood')

type Category = 'park' | 'wood' | 'cemetery' | 'plaza' | 'poi' | 'corner' | 'yard' | 'web'
type Pick = readonly (readonly [DecorKind, number])[]

/** Weights per category (the pick is by hash, so it is stable). */
const TABLE: Record<Exclude<Category, 'web'>, Pick> = {
  park: [['pumpkin', 4], ['jack', 3], ['crow', 1.5], ['candle', 1], ['graves', 1.2], ['bat', 2.5], ['fog', 2.5], ['skeleton', 0.6], ['scarecrow', 1], ['cauldron', 0.5], ['sign', 0.8], ['fence', 0.6]],
  wood: [['spider', 4], ['jack', 3], ['pumpkin', 2.5], ['bat', 3], ['fog', 3], ['crow', 1.5], ['sign', 0.8], ['candle', 1]],
  cemetery: [['graves', 6], ['candle', 2], ['crow', 2], ['skeleton', 1.2], ['fog', 3], ['bat', 3], ['jack', 1], ['sign', 1]],
  plaza: [['lantern', 3], ['pumpkin', 3], ['candle', 2], ['skeleton', 1.5], ['crow', 1], ['jack', 2.5], ['cauldron', 1], ['bat', 1.5], ['fog', 1.5], ['sign', 1]],
  poi: [['jack', 4], ['pumpkin', 3], ['candle', 2], ['lantern', 2], ['cauldron', 1], ['sign', 1], ['bat', 1.2], ['fog', 1.2]],
  corner: [['pumpkin', 3], ['lantern', 3], ['candle', 1], ['fence', 2], ['sign', 1.5], ['jack', 2]],
  yard: [['pumpkin', 4], ['jack', 2.5], ['candle', 1.5], ['lantern', 1.5], ['crow', 1], ['bat', 1.8], ['fence', 2], ['scarecrow', 0.8], ['cauldron', 0.7], ['fog', 1], ['sign', 0.5]],
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

const POI_RADIUS = 4

/** Forget the placement of a grid whose tiles changed (a streamed cell arrived or left). */
export function forgetDecor(grid: TileGrid, rect?: { x: number; y: number; w: number; h: number }): void {
  poiCache.delete(grid)
  plazaCache.delete(grid)
  const sizes = cache.get(grid)
  if (!sizes) return
  if (!rect) {
    cache.delete(grid)
    return
  }
  // A site reads its 3×3, the tile row above, the corners two tiles away and landmarks up to POI_RADIUS away.
  const reach = POI_RADIUS + 2
  for (const [size, byChunk] of sizes) {
    const cx0 = Math.floor((rect.x - reach) / size)
    const cx1 = Math.floor((rect.x + rect.w - 1 + reach) / size)
    const cy0 = Math.floor((rect.y - reach) / size)
    const cy1 = Math.floor((rect.y + rect.h - 1 + reach) / size)
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) byChunk.delete(cy * 32768 + cx)
  }
}


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
export function tileClear(grid: TileGrid, x: number, y: number, yard?: YardTest, low = false): boolean {
  for (const dy of [0, -1]) {
    const t = terrainAt(grid, x, y + dy)
    if (t < 0 || isStreet(t)) return false
    // A house or a landmark stands on building tiles: only open yard counts. A low item (under 13 art px)
    // may have the house wall behind it, like a pumpkin on a doorstep: only its own tile must be open.
    if (t === Terrain.building && !yard?.(x, y + dy) && !(low && dy === -1)) return false
  }
  return true
}

/** Kinds low enough (12 art px or less) to stand against a house wall. */
export const LOW_KINDS = new Set<DecorKind>(['pumpkin', 'jack', 'candle', 'lantern', 'crow', 'fence', 'cauldron'])

/** Half the sprite's width in tiles (art pixels / 32), for kinds that stand in a tile. Animated kinds, graves and webs keep a street-free 3×3 instead. */
export const HALF_WIDTH: Partial<Record<DecorKind, number>> = { pumpkin: 0.41, jack: 0.41, candle: 0.19, lantern: 0.28, crow: 0.35, scarecrow: 0.41, cauldron: 0.44, sign: 0.38, fence: 0.5, spider: 0.29 }
const TALL_KINDS = new Set<DecorKind>(['scarecrow', 'sign'])
/** A pumpkin's small companion reaches this far (tiles) to its side. */
const COMPANION_REACH = 0.8

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
    const style = grid.style[y * grid.cols + x]
    return { category: style === CEMETERY ? 'cemetery' : style === WOOD ? 'wood' : 'park', web: -1 }
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
export function decorInChunk(grid: TileGrid, cx: number, cy: number, size: number, yard?: YardTest, tree?: YardTest): ChunkDecor {
  let sizes = cache.get(grid)
  if (!sizes) cache.set(grid, (sizes = new Map()))
  let byChunk = sizes.get(size)
  if (!byChunk) sizes.set(size, (byChunk = new Map()))
  const key = cy * 32768 + cx
  const found = byChunk.get(key)
  if (found) return found
  const built = buildChunk(grid, cx, cy, size, yard, tree)
  byChunk.set(key, built)
  return built
}

function buildChunk(grid: TileGrid, cx: number, cy: number, size: number, yard?: YardTest, tree?: YardTest): ChunkDecor {
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
  const webs = new Set<string>()
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (unit(hash3(i, j, 1)) >= ACCEPT) continue
      const t = siteTile(grid, i, j)
      if (t.x < x0 || t.x >= x1 || t.y < y0 || t.y >= y1) continue
      const found = siteItem(grid, i, j, yard, tree)
      if (!found) continue
      const { item, category } = found
      // A square or pedestrian plaza keeps only a few accents, spread out (see `plazaPicks`).
      if (category === 'plaza' && !plazaPicks(grid, i, j, yard, tree).has(siteKey(i, j))) continue
      // Two sites can share a tile corner: one web there is enough.
      if (item.kind === 'web') {
        const wk = `${item.x},${item.y}`
        if (webs.has(wk)) continue
        webs.add(wk)
      }
      items.push(item)
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


/** The tile a lattice site falls in, and its exact position in tile units. */
function siteTile(grid: TileGrid, i: number, j: number): { x: number; y: number; fx: number; fy: number } {
  const t = grid.toTileXY(sitePoint(i, j))
  return { x: Math.floor(t.x), y: Math.floor(t.y), fx: t.x, fy: t.y }
}

type Found = { item: DecorItem; category: Category }

/** What stands at lattice site (i, j) on this grid, if anything: terrain, spacing and street tests included. Chunk limits are the caller's. */
function siteItem(grid: TileGrid, i: number, j: number, yard?: YardTest, tree?: YardTest): Found | undefined {
  const t = siteTile(grid, i, j)
  const tx = t.x
  const ty = t.y
  if (tree?.(tx, ty)) {
    // A garden tree: a spider now and then hangs from its crown.
    const spider = treeSpider(grid, i, j, tx, ty)
    return spider && !crowded(i, j) ? { item: spider, category: 'yard' } : undefined
  }
  if (!tileClear(grid, tx, ty, yard, true)) return undefined
  const site = classify(grid, tx, ty, yard)
  if (!site) return undefined
  const item = makeItem(grid, i, j, tx, ty, site, t.fx, t.fy)
  if (!item) return undefined
  // The spacing rule is checked last: it is the dearest test, and most sites fail on terrain first.
  if (crowded(i, j)) return undefined
  if (!LOW_KINDS.has(item.kind) && !tileClear(grid, tx, ty, yard)) return undefined
  // Things that roam, spread, stand in groups or sit on a tile corner need the whole 3×3 free of streets.
  if ((item.animated || item.kind === 'graves' || item.kind === 'web') && !clearOfStreets(grid, tx, ty)) return undefined
  return { item, category: site.category }
}

/** Plaza sites per block and the least distance between two (halloween-decor spec, task 91.1). */
export const PLAZA_BLOCK = 40
export const PLAZA_CAP = 2
export const PLAZA_GAP_M = 20
const siteKey = (i: number, j: number): string => `${i},${j}`

const plazaCache = new WeakMap<TileGrid, Map<string, ReadonlySet<string>>>()

/**
 * The few plaza sites of the block around (i, j) that stand: the candidates on plaza ground of a block of
 * `PLAZA_BLOCK` lattice steps (about 150 m), lowest rank first, at most `PLAZA_CAP`, each `PLAZA_GAP_M` from
 * the ones before. The block is fixed on the lattice, so every chunk of every frame reads the same answer.
 */
function plazaPicks(grid: TileGrid, i: number, j: number, yard?: YardTest, tree?: YardTest): ReadonlySet<string> {
  const bi = Math.floor(i / PLAZA_BLOCK)
  const bj = Math.floor(j / PLAZA_BLOCK)
  const key = `${bi},${bj}`
  let blocks = plazaCache.get(grid)
  if (!blocks) plazaCache.set(grid, (blocks = new Map()))
  const known = blocks.get(key)
  if (known) return known
  const cands: { i: number; j: number; rank: number; p: { lat: number; lon: number } }[] = []
  for (let a = bi * PLAZA_BLOCK; a < (bi + 1) * PLAZA_BLOCK; a++) {
    for (let b = bj * PLAZA_BLOCK; b < (bj + 1) * PLAZA_BLOCK; b++) {
      if (unit(hash3(a, b, 1)) >= ACCEPT) continue
      const f = siteItem(grid, a, b, yard, tree)
      if (f?.category === 'plaza') cands.push({ i: a, j: b, rank: f.item.rank, p: sitePoint(a, b) })
    }
  }
  cands.sort((p, q) => p.rank - q.rank || p.i - q.i || p.j - q.j)
  const picked: typeof cands = []
  for (const c of cands) {
    if (picked.length >= PLAZA_CAP) break
    const cos = Math.cos((c.p.lat * Math.PI) / 180)
    if (picked.some((o) => Math.hypot((o.p.lat - c.p.lat) * M_PER_DEG, (o.p.lon - c.p.lon) * M_PER_DEG * cos) < PLAZA_GAP_M)) continue
    picked.push(c)
  }
  const set = new Set(picked.map((c) => siteKey(c.i, c.j)))
  blocks.set(key, set)
  return set
}

/** Where a lattice site stands: latitude and longitude in degrees, from the hashes alone. */
function sitePoint(i: number, j: number): { lat: number; lon: number } {
  return { lat: (i + unit(hash3(i, j, 2))) * LAT_STEP, lon: (j + unit(hash3(i, j, 3))) * LON_STEP }
}

/** A neighbouring site of lower rank is a candidate closer than `MIN_GAP_M`: this one gives way. Independent of the grid, so every frame agrees. */
function crowded(i: number, j: number): boolean {
  const me = unit(hash3(i, j, 9))
  const p = sitePoint(i, j)
  const cos = Math.cos((p.lat * Math.PI) / 180)
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue
      if (unit(hash3(i + di, j + dj, 1)) >= ACCEPT) continue
      const other = unit(hash3(i + di, j + dj, 9))
      if (other > me || (other === me && (di < 0 || (di === 0 && dj < 0)))) continue
      const q = sitePoint(i + di, j + dj)
      if (Math.hypot((q.lat - p.lat) * M_PER_DEG, (q.lon - p.lon) * M_PER_DEG * cos) < MIN_GAP_M) return true
    }
  }
  return false
}

function treeSpider(grid: TileGrid, i: number, j: number, tx: number, ty: number): DecorItem | undefined {
  if (unit(hash3(i, j, 12)) >= 0.35) return undefined
  if (isStreet(terrainAt(grid, tx, ty)) || terrainAt(grid, tx, ty) < 0) return undefined
  return {
    kind: 'spider',
    x: tx + 0.5,
    y: ty + 0.6,
    tx,
    ty,
    variant: 0,
    n: 1,
    rank: unit(hash3(i, j, 9)),
    nightOnly: false,
    animated: false,
    order: -1,
    phase: unit(hash3(i, j, 10)),
  }
}

function makeItem(grid: TileGrid, i: number, j: number, tx: number, ty: number, site: Site, sx: number, sy: number): DecorItem | undefined {
  const kind: DecorKind = site.category === 'web' ? 'web' : pickKind(TABLE[site.category], hash3(i, j, 4))
  if (kind === 'graves' && !roomForGraves(grid, tx, ty)) return undefined
  const web = kind === 'web'
  // Foot of the sprite: the site's own position inside its tile (so the spacing rule holds for what is drawn).
  let fx = Math.min(0.999, Math.max(0, sx - tx))
  // Moving items start 0.25 tile down so their sprite stays inside the street-free 3×3 above.
  const fy = Math.min(0.999, Math.max(ANIMATED.has(kind) ? 0.25 : 0, sy - ty))
  // Sprites over 16 art pixels tall (scarecrow, signpost) also reach the second tile above: it must not be a street.
  if (TALL_KINDS.has(kind) && (terrainAt(grid, tx, ty - 2) < 0 || isStreet(terrainAt(grid, tx, ty - 2)))) return undefined
  // The sprite's sides must not reach a street (or a tile without data): shift it inward, (a little; further and the site is dropped).
  const hw = HALF_WIDTH[kind] ?? 0
  const blocked = (dx: number) => {
    const t = terrainAt(grid, tx + dx, ty)
    return t < 0 || isStreet(t)
  }
  if (hw > 0) {
    const from = fx
    if (fx - hw < 0 && blocked(-1)) fx = hw
    if (fx + hw > 1 && blocked(1)) fx = 1 - hw
    // A big shift would crowd the neighbouring sites that the spacing rule keeps apart: the site gives way instead.
    if (Math.abs(fx - from) > 0.15) return undefined
  }
  // The small pumpkin beside a pumpkin needs open ground on that side.
  let variant = web ? site.web : Math.floor(unit(hash3(i, j, 7)) * 3)
  if (kind === 'pumpkin' && variant > 0) {
    const side = variant === 1 ? 1 : -1
    const t = terrainAt(grid, tx + side, ty)
    const room = side > 0 ? fx + COMPANION_REACH <= 1 : fx - COMPANION_REACH >= 0
    if (!room && !(t === Terrain.park || t === Terrain.ground || t === Terrain.plaza)) variant = 0
  }
  return {
    kind,
    x: web ? tx + (site.web & 1 ? 1 : 0) : tx + fx,
    y: web ? ty + (site.web & 2 ? 1 : 0) : ty + fy,
    tx,
    ty,
    variant,
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
