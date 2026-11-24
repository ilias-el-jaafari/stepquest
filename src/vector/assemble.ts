import type { BBox } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { cellBBox, type CellId } from '../world/cells.ts'
import { SLICE_MARGIN_DEG, sliceToCells, type CellRecord } from '../world/slice.ts'
import { tileBBox, tileKey, tilesInBBox, type TileId } from './tileMath.ts'

/** Vector tiles that draw the detail layer (buildings, paths, landmarks): the most detailed zoom OpenFreeMap serves. */
export const DETAIL_Z = 14
/** Vector tiles that draw the coarse layer (streets, green, water; no buildings at this zoom): one tile is about 7.5 km. */
export const COARSE_Z = 12
/**
 * A detail cell is assembled from the tiles that meet the cell grown by this much (about 400 m), so a
 * building that crosses a tile seam is seen whole by every cell it touches (requirement 21.6); the
 * spill of `TileWorld` (80 tiles, 400 m) is the same reach.
 */
export const GROW_DEG = 0.004

const grow = (b: BBox, d: number): BBox => ({ south: b.south - d, west: b.west - d, north: b.north + d, east: b.east + d })

/** The tiles of zoom `z` a cell is assembled from. */
export function tilesForCell(c: CellId, z: number): TileId[] {
  return tilesInBBox(grow(cellBBox(c), z === COARSE_Z ? SLICE_MARGIN_DEG : GROW_DEG), z)
}

export type LoadedTile = { id: TileId; data: OsmData }

function boxOf(data: OsmData, nodes: readonly number[]): BBox {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const n of nodes) {
    const la = data.lat[n]!
    const lo = data.lon[n]!
    if (la < south) south = la
    if (la > north) north = la
    if (lo < west) west = lo
    if (lo > east) east = lo
  }
  return { south, west, north, east }
}

/** Tile edge coordinates after the codec (1e-6°) may differ from the exact edge by half a step. */
const EDGE_EPS = 1e-6

type Span = [number, number]
type Piece = { tile: number; way: OsmWay; box: BBox; edges: { n?: Span; s?: Span; w?: Span; e?: Span } }

/** Where an outer ring lies on its tile's edges: per side, the span along the edge. */
function edgesOf(data: OsmData, nodes: readonly number[], t: BBox): Piece['edges'] {
  const out: Piece['edges'] = {}
  const add = (side: keyof Piece['edges'], v: number) => {
    const span = out[side]
    out[side] = span ? [Math.min(span[0], v), Math.max(span[1], v)] : [v, v]
  }
  for (const n of nodes) {
    const la = data.lat[n]!
    const lo = data.lon[n]!
    if (Math.abs(la - t.north) < EDGE_EPS) add('n', lo)
    if (Math.abs(la - t.south) < EDGE_EPS) add('s', lo)
    if (Math.abs(lo - t.west) < EDGE_EPS) add('w', la)
    if (Math.abs(lo - t.east) < EDGE_EPS) add('e', la)
  }
  return out
}

const overlaps = (a: Span | undefined, b: Span | undefined) => !!a && !!b && a[0] <= b[1] + EDGE_EPS && b[0] <= a[1] + EDGE_EPS

/**
 * Give every building piece that meets another across a tile seam the same anchor: the centre of
 * the box of the whole group. Pieces meet when they lie on the shared edge of two neighbouring tiles
 * over overlapping spans. The anchor depends only on the geometry, so every cell that sees the whole
 * group computes the same one, and exactly one cell builds its houses.
 */
export function anchorBuildings(tiles: readonly LoadedTile[]): Map<OsmWay, { lat: number; lon: number }> {
  const pieces: Piece[] = []
  tiles.forEach((t, k) => {
    const tb = tileBBox(t.id)
    for (const way of t.data.ways) {
      if (way.kind !== 'building' || !way.area) continue
      pieces.push({ tile: k, way, box: boxOf(t.data, way.nodes), edges: edgesOf(t.data, way.nodes, tb) })
    }
  })
  const parent = pieces.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const at = new Map(tiles.map((t, k) => [tileKey(t.id), k]))
  const byTile = new Map<number, number[]>()
  pieces.forEach((p, i) => {
    const list = byTile.get(p.tile)
    if (list) list.push(i)
    else byTile.set(p.tile, [i])
  })
  for (const [k, list] of byTile) {
    const id = tiles[k]!.id
    const east = at.get(tileKey({ z: id.z, x: id.x + 1, y: id.y }))
    const south = at.get(tileKey({ z: id.z, x: id.x, y: id.y + 1 }))
    for (const i of list) {
      const p = pieces[i]!
      if (east !== undefined && p.edges.e) for (const j of byTile.get(east) ?? []) if (overlaps(p.edges.e, pieces[j]!.edges.w)) union(i, j)
      if (south !== undefined && p.edges.s) for (const j of byTile.get(south) ?? []) if (overlaps(p.edges.s, pieces[j]!.edges.n)) union(i, j)
    }
  }
  const boxes = new Map<number, BBox>()
  const count = new Map<number, number>()
  pieces.forEach((p, i) => {
    const r = find(i)
    count.set(r, (count.get(r) ?? 0) + 1)
    const b = boxes.get(r)
    boxes.set(r, b ? { south: Math.min(b.south, p.box.south), west: Math.min(b.west, p.box.west), north: Math.max(b.north, p.box.north), east: Math.max(b.east, p.box.east) } : p.box)
  })
  const out = new Map<OsmWay, { lat: number; lon: number }>()
  pieces.forEach((p, i) => {
    const r = find(i)
    // A piece alone keeps the default rule (centre of its own box), which is the same point.
    if ((count.get(r) ?? 1) < 2) return
    const b = boxes.get(r)!
    out.set(p.way, { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 })
  })
  return out
}

/** Join several tiles' data into one extract over `bbox` (node tables concatenated; anchors set on building groups). */
export function mergeTiles(tiles: readonly LoadedTile[], bbox: BBox, withAnchors: boolean): OsmData {
  const anchors = withAnchors ? anchorBuildings(tiles) : new Map<OsmWay, { lat: number; lon: number }>()
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = []
  const pois: OsmData['pois'] = []
  let id = 1
  for (const t of [...tiles].sort((a, b) => a.id.y - b.id.y || a.id.x - b.id.x)) {
    const base = lat.length
    for (let n = 0; n < t.data.lat.length; n++) {
      lat.push(t.data.lat[n]!)
      lon.push(t.data.lon[n]!)
    }
    const shift = (r: number[]) => r.map((n) => n + base)
    for (const w of t.data.ways) {
      const anchor = anchors.get(w)
      ways.push({ ...w, id: id++, nodes: shift(w.nodes), ...(w.holes ? { holes: w.holes.map(shift) } : {}), ...(anchor ? { anchor } : {}) })
    }
    pois.push(...t.data.pois)
  }
  return { bbox, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois, industrial: [], activity: [], source: 'tiles', timestamp: '' }
}

/**
 * The record of one cell drawn from vector tiles (requirement 21.5): every tile of `tilesForCell`
 * must be given. A detail record gets building anchors; a coarse one does not need them.
 */
export function cellFromTiles(c: CellId, tiles: readonly LoadedTile[], detail: boolean): CellRecord | undefined {
  const box = cellBBox(c)
  return sliceToCells(mergeTiles(tiles, box, detail), [c], box)[0]
}
