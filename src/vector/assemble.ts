import type { BBox } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { cellBBox, type CellId } from '../world/cells.ts'
import { SLICE_MARGIN_DEG, type CellRecord } from '../world/slice.ts'
import { tileBBox, tileKey, tilesInBBox, type TileId } from './tileMath.ts'

/** Vector tiles that draw the detail layer (buildings, paths, landmarks): the most detailed zoom OpenFreeMap serves. */
export const DETAIL_Z = 14
/**
 * Vector tiles that draw the coarse layer (requirement 21.4): z13, about 3.8 km, the first zoom with
 * buildings and every street class, so the far zooms look the same wherever the data came from.
 */
export const COARSE_Z = 13
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

const boxCache = new WeakMap<OsmData, BBox[]>()

/** The box of every way of a tile, computed once per tile object. */
function wayBoxes(data: OsmData): BBox[] {
  let boxes = boxCache.get(data)
  if (!boxes) boxCache.set(data, (boxes = data.ways.map((w) => boxOf(data, w.nodes))))
  return boxes
}

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
    const boxes = wayBoxes(t.data)
    t.data.ways.forEach((way, w) => {
      if (way.kind !== 'building' || !way.area) return
      const box = boxes[w]!
      // Only a piece whose box reaches its tile's edge can meet a piece of a neighbour.
      const onEdge = box.north > tb.north - EDGE_EPS || box.south < tb.south + EDGE_EPS || box.west < tb.west + EDGE_EPS || box.east > tb.east - EDGE_EPS
      pieces.push({ tile: k, way, box, edges: onEdge ? edgesOf(t.data, way.nodes, tb) : {} })
    })
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
    const westSide = east === undefined ? [] : (byTile.get(east) ?? []).filter((j) => pieces[j]!.edges.w)
    const northSide = south === undefined ? [] : (byTile.get(south) ?? []).filter((j) => pieces[j]!.edges.n)
    for (const i of list) {
      const p = pieces[i]!
      if (p.edges.e) for (const j of westSide) if (overlaps(p.edges.e, pieces[j]!.edges.w)) union(i, j)
      if (p.edges.s) for (const j of northSide) if (overlaps(p.edges.s, pieces[j]!.edges.n)) union(i, j)
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

/** Anchors of the last few tile sets: neighbouring cells are usually built from the same tiles. */
const anchorCache: { key: string; tiles: readonly OsmData[]; anchors: Map<OsmWay, { lat: number; lon: number }> }[] = []
function cachedAnchors(tiles: readonly LoadedTile[]): Map<OsmWay, { lat: number; lon: number }> {
  const key = tiles.map((t) => tileKey(t.id)).sort().join(';')
  const hit = anchorCache.find((e) => e.key === key && e.tiles.length === tiles.length && tiles.every((t) => e.tiles.includes(t.data)))
  if (hit) return hit.anchors
  const anchors = anchorBuildings(tiles)
  anchorCache.unshift({ key, tiles: tiles.map((t) => t.data), anchors })
  anchorCache.length = Math.min(anchorCache.length, 4)
  return anchors
}

const meets = (a: BBox, b: BBox) => a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west
const inHalfOpen = (b: BBox, la: number, lo: number) => la >= b.south && la < b.north && lo >= b.west && lo < b.east

/**
 * The record of one cell drawn from vector tiles (requirement 21.5); every tile of `tilesForCell`
 * must be given. Only the ways that meet the cell (with the slice margin) are copied, plus, for a
 * detail record, every piece of a building group whose anchor lies in the cell (so the cell that
 * owns a building has all of it). Points of interest go to the cell they lie in.
 */
export function cellFromTiles(c: CellId, tiles: readonly LoadedTile[], detail: boolean): CellRecord | undefined {
  const box = cellBBox(c)
  const near = grow(box, SLICE_MARGIN_DEG)
  const anchors = detail ? cachedAnchors(tiles) : new Map<OsmWay, { lat: number; lon: number }>()
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = []
  const pois: OsmData['pois'] = []
  const sights: NonNullable<OsmData['sights']> = []
  let id = 1
  for (const t of [...tiles].sort((a, b) => a.id.y - b.id.y || a.id.x - b.id.x)) {
    const boxes = wayBoxes(t.data)
    const remap = new Map<number, number>()
    const node = (n: number) => {
      let at = remap.get(n)
      if (at === undefined) {
        at = lat.length
        remap.set(n, at)
        lat.push(t.data.lat[n]!)
        lon.push(t.data.lon[n]!)
      }
      return at
    }
    t.data.ways.forEach((w, k) => {
      const anchor = anchors.get(w)
      const owned = anchor !== undefined && inHalfOpen(box, anchor.lat, anchor.lon)
      if (!owned && !meets(boxes[k]!, near)) return
      ways.push({ ...w, id: id++, nodes: w.nodes.map(node), ...(w.holes ? { holes: w.holes.map((h) => h.map(node)) } : {}), ...(anchor ? { anchor } : {}) })
    })
    for (const p of t.data.pois) if (inHalfOpen(box, p.lat, p.lon)) pois.push(p)
    for (const s of t.data.sights ?? []) if (inHalfOpen(box, s.lat, s.lon)) sights.push(s)
  }
  const data: OsmData = { bbox: box, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois, ...(sights.length ? { sights } : {}), industrial: [], activity: [], source: 'tiles', timestamp: '' }
  return { cell: c, coverage: box, data, savedAt: 0 }
}
