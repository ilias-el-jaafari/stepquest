import { LocalProjection, type BBox, type LatLon } from '../geo/geo.ts'

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
} as const
export type TerrainId = (typeof Terrain)[keyof typeof Terrain]

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

  constructor(bbox: BBox, metresPerTile = DEFAULT_METRES_PER_TILE) {
    this.bbox = bbox
    this.metresPerTile = metresPerTile
    // Origin at the north-west corner so tile (0,0) is top-left.
    this.projection = new LocalProjection({ lat: bbox.north, lon: bbox.west })
    const se = this.projection.toXY({ lat: bbox.south, lon: bbox.east })
    this.cols = Math.max(1, Math.ceil(se.x / metresPerTile))
    this.rows = Math.max(1, Math.ceil(se.y / metresPerTile))
    this.layers = new Uint8Array(this.cols * this.rows)
    this.terrain = new Uint8Array(this.cols * this.rows)
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
    return { x: x / this.metresPerTile, y: y / this.metresPerTile }
  }

  tileToLatLon(tx: number, ty: number): LatLon {
    return this.projection.toLatLon(tx * this.metresPerTile, ty * this.metresPerTile)
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
  if (bits & Layer.building) return Terrain.building
  if (bits & Layer.water) return Terrain.water
  if (bits & Layer.park) return Terrain.park
  return Terrain.ground
}
