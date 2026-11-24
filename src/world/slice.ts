import type { BBox } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { cellBBox, cellKey, cellsInBBox, type CellId } from './cells.ts'
import { intersectBoxes } from './coverage.ts'

/**
 * What one cell holds: the data of the ways, points and land that meet the cell, and the part of the
 * cell the data really covers (`coverage`; the whole cell for a downloaded cell, less for a cell at
 * the edge of a bundled extract). `data.bbox` is the coverage.
 */
export type CellRecord = { cell: CellId; coverage: BBox; data: OsmData; savedAt: number }

/** Whether the record covers its whole cell (a partial one is fetched again as a whole when in view). */
export function isComplete(r: Pick<CellRecord, 'cell' | 'coverage'>): boolean {
  const b = cellBBox(r.cell)
  const eps = 1e-9
  return r.coverage.south <= b.south + eps && r.coverage.west <= b.west + eps && r.coverage.north >= b.north - eps && r.coverage.east >= b.east - eps
}

function wayBox(data: OsmData, way: OsmWay): BBox {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const n of way.nodes) {
    const la = data.lat[n]!
    const lo = data.lon[n]!
    if (la < south) south = la
    if (la > north) north = la
    if (lo < west) west = lo
    if (lo > east) east = lo
  }
  return { south, west, north, east }
}

const meets = (a: BBox, b: BBox) => a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west

/**
 * Ways this close to a cell (degrees, about 40 m) also go to it: a wide road or a river just outside
 * the border still paints the tiles next to it (the cell is rasterized with an apron).
 */
export const SLICE_MARGIN_DEG = 0.0004

const grow = (b: BBox, d: number): BBox => ({ south: b.south - d, west: b.west - d, north: b.north + d, east: b.east + d })

/**
 * Cut an extract into per-cell records for the cells given (default: every cell the extract's box
 * touches). A way goes to every cell its bounding box meets, whole (all its points), so a street that
 * crosses a border is complete in both. Points of interest and lively places go to the one cell they
 * lie in (south and west edges included, north and east excluded). Ways within `SLICE_MARGIN_DEG` count. Node tables are compacted per cell.
 * `area` is what the extract really covers (default its own box).
 */
export function sliceToCells(data: OsmData, cells: readonly CellId[] = cellsInBBox(data.bbox), area: BBox = data.bbox, savedAt = 0): CellRecord[] {
  const boxes = data.ways.map((w) => wayBox(data, w))
  const rings = (data.industrial ?? []).map((r) => wayBox(data, { nodes: r } as OsmWay))
  const out: CellRecord[] = []
  for (const cell of cells) {
    const coverage = intersectBoxes(cellBBox(cell), area)
    if (!coverage) continue
    const remap = new Map<number, number>()
    const lat: number[] = []
    const lon: number[] = []
    const node = (n: number) => {
      let at = remap.get(n)
      if (at === undefined) {
        at = lat.length
        remap.set(n, at)
        lat.push(data.lat[n]!)
        lon.push(data.lon[n]!)
      }
      return at
    }
    const near = grow(coverage, SLICE_MARGIN_DEG)
    const ways: OsmWay[] = []
    data.ways.forEach((w, k) => {
      if (!meets(boxes[k]!, near)) return
      ways.push({ ...w, nodes: w.nodes.map(node), ...(w.holes ? { holes: w.holes.map((h) => h.map(node)) } : {}) })
    })
    const industrial: number[][] = []
    ;(data.industrial ?? []).forEach((r, k) => {
      if (meets(rings[k]!, near)) industrial.push(r.map(node))
    })
    const inHalfOpen = (la: number, lo: number) => la >= coverage.south && la < coverage.north && lo >= coverage.west && lo < coverage.east
    const activity: number[] = []
    const act = data.activity ?? []
    for (let i = 0; i + 1 < act.length; i += 2) if (inHalfOpen(act[i]!, act[i + 1]!)) activity.push(act[i]!, act[i + 1]!)
    out.push({
      cell,
      coverage,
      savedAt,
      data: {
        bbox: coverage,
        lat: Float64Array.from(lat),
        lon: Float64Array.from(lon),
        ways,
        pois: data.pois.filter((p) => inHalfOpen(p.lat, p.lon)),
        industrial,
        activity,
        source: data.source,
        timestamp: data.timestamp,
      },
    })
  }
  return out
}

export const recordKey = (r: Pick<CellRecord, 'cell'>): string => cellKey(r.cell)
