import { LocalProjection, type BBox, type LatLon } from '../geo/geo.ts'
import type { Poi } from '../osm/types.ts'

/** Pixel size of one tile in the tileset (classic 16×16 console tiles). */
export const TILE_PX = 16
/** Real-world size of one tile. 5 m keeps a two-lane street about two tiles wide. */
export const DEFAULT_METRES_PER_TILE = 5

/** Raw layer bits; a tile can hold several (a footway crossing a road). */
export const Layer = {
  water: 1,
  park: 2,
  building: 4,
  road: 8,
  path: 16,
  /** Marked crossing: only these turn road tiles into zebra crossings. */
  crossing: 32,
  /** Paved square or pedestrian area (drawn as plaza paving). */
  plaza: 64,
  /** Road tile of a way mapped lit=yes (street lamps are drawn along these at night). */
  lit: 128,
} as const
export type LayerName = keyof typeof Layer

/** Resolved terrain drawn for a tile (one per tile). */
export const Terrain = {
  ground: 0,
  park: 1,
  water: 2,
  building: 3,
  road: 4,
  path: 5,
  crossing: 6,
  plaza: 7,
} as const

/** Park styles stored per tile in TileGrid.style (index into this list). */
export const PARK_STYLES = ['park', 'garden', 'grass', 'pitch', 'playground', 'wood', 'farmland', 'orchard', 'cemetery'] as const
export type ParkStyleName = (typeof PARK_STYLES)[number]

/** Building styles stored per building tile in TileGrid.style. */
export const BUILDING_STYLES = ['block', 'house', 'industrial'] as const

/** Barrier kinds stored per tile in TileGrid.barrier (0 = none). */
export const BARRIERS = ['', 'fence', 'hedge', 'wall'] as const
export type TerrainId = (typeof Terrain)[keyof typeof Terrain]

/** A rectangle of tiles. */
export type TileRect = { x: number; y: number; w: number; h: number }

export class TileGrid {
  readonly cols: number
  readonly rows: number
  readonly metresPerTile: number
  readonly projection: LocalProjection
  readonly bbox: BBox
  /** Bitset of Layer flags per tile, row-major. */
  readonly layers: Uint8Array
  /** Resolved terrain per tile, filled by resolveTerrain(). */
  readonly terrain: Uint8Array
  /** Park style (park tiles) or building style (building tiles), see PARK_STYLES / BUILDING_STYLES. */
  readonly style: Uint8Array
  /** Fence, hedge or wall line through the tile, see BARRIERS. */
  readonly barrier: Uint8Array
  /** 1 where a bridge deck (a bridge=* road or path) covers the tile; tracks underneath are not drawn there. */
  readonly bridge: Uint8Array
  /** Landmark points from the map data. */
  pois: Poi[] = []
  /** Above-ground tram, metro and train tracks as tile-coordinate polylines. */
  rails: { x: number; y: number }[][] = []
  /**
   * Tiles that hold loaded map data (1) in a streamed world; tiles at 0 are drawn as "no data yet".
   * Undefined for a single extract, where every tile is loaded.
   */
  covered: Uint8Array | undefined
  /** Tile offset of this grid inside the frame it was cut from (0 for a stand-alone grid). */
  readonly offsetX: number
  readonly offsetY: number

  /**
   * A grid over `bbox`, or (with `window`) a small grid that shares the projection of a larger
   * `frame` and starts at tile (x0, y0) of it: its tile (0, 0) is the frame's tile (x0, y0), so a
   * cell rasterized into a window lines up exactly with its neighbours when copied into the frame.
   */
  constructor(bbox: BBox, metresPerTile = DEFAULT_METRES_PER_TILE, window?: { frame: TileGrid; x0: number; y0: number; cols: number; rows: number }) {
    this.metresPerTile = window ? window.frame.metresPerTile : metresPerTile
    if (window) {
      this.projection = window.frame.projection
      this.offsetX = window.frame.offsetX + window.x0
      this.offsetY = window.frame.offsetY + window.y0
      this.cols = Math.max(1, window.cols)
      this.rows = Math.max(1, window.rows)
      const nw = this.tileToLatLon(0, 0)
      const se = this.tileToLatLon(this.cols, this.rows)
      this.bbox = { south: se.lat, west: nw.lon, north: nw.lat, east: se.lon }
    } else {
      this.bbox = bbox
      this.offsetX = 0
      this.offsetY = 0
      // Origin at the north-west corner so tile (0,0) is top-left.
      this.projection = new LocalProjection({ lat: bbox.north, lon: bbox.west })
      const se = this.projection.toXY({ lat: bbox.south, lon: bbox.east })
      this.cols = Math.max(1, Math.ceil(se.x / metresPerTile))
      this.rows = Math.max(1, Math.ceil(se.y / metresPerTile))
    }
    this.layers = new Uint8Array(this.cols * this.rows)
    this.terrain = new Uint8Array(this.cols * this.rows)
    this.style = new Uint8Array(this.cols * this.rows)
    this.barrier = new Uint8Array(this.cols * this.rows)
    this.bridge = new Uint8Array(this.cols * this.rows)
  }

  set(arr: Uint8Array, tx: number, ty: number, value: number): void {
    if (this.inBounds(tx, ty)) arr[this.index(tx, ty)] = value
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows
  }

  index(tx: number, ty: number): number {
    return ty * this.cols + tx
  }

  /** Continuous tile coordinates (tile units, 0.5 = centre of tile 0). */
  toTileXY(p: LatLon): { x: number; y: number } {
    const { x, y } = this.projection.toXY(p)
    return { x: x / this.metresPerTile - this.offsetX, y: y / this.metresPerTile - this.offsetY }
  }

  tileToLatLon(tx: number, ty: number): LatLon {
    return this.projection.toLatLon((tx + this.offsetX) * this.metresPerTile, (ty + this.offsetY) * this.metresPerTile)
  }

  /** A window of this grid (see the constructor): same projection, tile (0, 0) at this grid's (x0, y0). */
  window(x0: number, y0: number, cols: number, rows: number): TileGrid {
    return new TileGrid(this.bbox, this.metresPerTile, { frame: this, x0, y0, cols, rows })
  }

  /**
   * Copy the tiles of `rect` (in this grid's tiles) from a window of this grid, and mark them covered.
   * Tiles of the rectangle outside either grid are skipped.
   */
  copyFrom(win: TileGrid, rect: TileRect): void {
    const dx = win.offsetX - this.offsetX
    const dy = win.offsetY - this.offsetY
    const x0 = Math.max(rect.x, dx, 0)
    const x1 = Math.min(rect.x + rect.w, dx + win.cols, this.cols)
    if (x1 <= x0) return
    this.covered ??= new Uint8Array(this.cols * this.rows)
    for (let y = Math.max(rect.y, dy, 0); y < Math.min(rect.y + rect.h, dy + win.rows, this.rows); y++) {
      const from = win.index(x0 - dx, y - dy)
      const to = this.index(x0, y)
      const n = x1 - x0
      for (const k of ['layers', 'terrain', 'style', 'barrier', 'bridge'] as const) this[k].set(win[k].subarray(from, from + n), to)
      this.covered.fill(1, to, to + n)
    }
  }

  /** Empty the tiles of `rect` (a cell that was dropped) and mark them not covered. */
  clearRect(rect: TileRect): void {
    const x0 = Math.max(0, rect.x)
    const x1 = Math.min(this.cols, rect.x + rect.w)
    if (x1 <= x0) return
    this.covered ??= new Uint8Array(this.cols * this.rows)
    for (let y = Math.max(0, rect.y); y < Math.min(this.rows, rect.y + rect.h); y++) {
      const from = this.index(x0, y)
      for (const k of ['layers', 'terrain', 'style', 'barrier', 'bridge', 'covered'] as const) this[k]!.fill(0, from, from + x1 - x0)
    }
  }

  /** Whether a tile holds loaded data (always, for a single extract). */
  coveredAt(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && (!this.covered || this.covered[this.index(tx, ty)] === 1)
  }

  add(tx: number, ty: number, bits: number): void {
    if (!this.inBounds(tx, ty)) return
    const i = this.index(tx, ty)
    this.layers[i] = (this.layers[i] ?? 0) | bits
  }

  has(tx: number, ty: number, bits: number): boolean {
    if (!this.inBounds(tx, ty)) return false
    return ((this.layers[this.index(tx, ty)] ?? 0) & bits) !== 0
  }

  bridgeAt(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.bridge[this.index(tx, ty)] === 1
  }

  terrainAt(tx: number, ty: number): TerrainId | undefined {
    if (!this.inBounds(tx, ty)) return undefined
    return (this.terrain[this.index(tx, ty)] ?? 0) as TerrainId
  }

  /** Collapse layer bits to one drawable terrain per tile. */
  resolveTerrain(): void {
    for (let i = 0; i < this.layers.length; i++) {
      this.terrain[i] = resolveLayers(this.layers[i] ?? 0)
    }
  }
}

export function resolveLayers(bits: number): TerrainId {
  const road = (bits & Layer.road) !== 0
  const path = (bits & Layer.path) !== 0
  // Sidewalks often overlap the carriageway we draw; only tagged crossings get zebras.
  if (road && (bits & Layer.crossing) !== 0) return Terrain.crossing
  if (road) return Terrain.road
  if (path) return Terrain.path
  if (bits & Layer.plaza) return Terrain.plaza
  if (bits & Layer.building) return Terrain.building
  if (bits & Layer.water) return Terrain.water
  if (bits & Layer.park) return Terrain.park
  return Terrain.ground
}
