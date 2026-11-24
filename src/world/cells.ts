import { M_PER_DEG_LAT, MAX_LAT, type BBox, type LatLon } from '../geo/geo.ts'

/**
 * Fixed geographic data cells: 0.01° of latitude by 0.01° of longitude (about 1.1 × 0.9 km at
 * València). A cell is named by two integers, so every point is in exactly one cell and
 * neighbours share an edge exactly (`i / 100` is the same double from both sides). Pure maths,
 * no DOM. See design.md, "Streaming multi-area world", for why this size.
 */
export const CELL_DEG = 0.01
const PER_DEG = 100
/** Float noise guard so 39.48 (stored as 39.4799999…) stays on its own cell line. */
const EPS = 1e-7

export type CellId = { i: number; j: number }

/** Largest batch one request may carry (cells that form one rectangle). */
export const MAX_BATCH_CELLS = 4

export const cellKey = (c: CellId): string => `${c.i},${c.j}`

export function parseCellKey(key: string): CellId | undefined {
  const m = /^(-?\d+),(-?\d+)$/.exec(key)
  return m ? { i: Number(m[1]), j: Number(m[2]) } : undefined
}

export const sameCell = (a: CellId, b: CellId): boolean => a.i === b.i && a.j === b.j

/** Cell indices run over the valid map: latitude cells up to `MAX_LAT`, longitude over ±180. */
const MAX_I = Math.floor(MAX_LAT * PER_DEG)
const MAX_J = 180 * PER_DEG

export function isValidCell(c: CellId): boolean {
  return Number.isInteger(c.i) && Number.isInteger(c.j) && c.i >= -MAX_I && c.i < MAX_I && c.j >= -MAX_J && c.j < MAX_J
}

/** The cell a point is in (a point on a shared edge belongs to the cell north-east of it). */
export function cellOf(p: LatLon): CellId {
  return { i: Math.floor(p.lat * PER_DEG + EPS), j: Math.floor(p.lon * PER_DEG + EPS) }
}

export function cellBBox(c: CellId): BBox {
  return { south: c.i / PER_DEG, west: c.j / PER_DEG, north: (c.i + 1) / PER_DEG, east: (c.j + 1) / PER_DEG }
}

export function cellCentre(c: CellId): LatLon {
  return { lat: (c.i + 0.5) / PER_DEG, lon: (c.j + 0.5) / PER_DEG }
}

/** Cells whose area meets the box (a box that only touches an edge does not include the cell beyond it). */
export function cellsInBBox(b: BBox): CellId[] {
  if (![b.south, b.west, b.north, b.east].every(Number.isFinite) || b.south > b.north || b.west > b.east) return []
  const i0 = Math.floor(b.south * PER_DEG + EPS)
  const i1 = Math.max(i0, Math.ceil(b.north * PER_DEG - EPS) - 1)
  const j0 = Math.floor(b.west * PER_DEG + EPS)
  const j1 = Math.max(j0, Math.ceil(b.east * PER_DEG - EPS) - 1)
  const out: CellId[] = []
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push({ i, j })
  return out.filter(isValidCell)
}

/** Smallest box that holds all the given cells. */
export function cellsBBox(cells: readonly CellId[]): BBox {
  let i0 = Infinity
  let i1 = -Infinity
  let j0 = Infinity
  let j1 = -Infinity
  for (const c of cells) {
    i0 = Math.min(i0, c.i)
    i1 = Math.max(i1, c.i)
    j0 = Math.min(j0, c.j)
    j1 = Math.max(j1, c.j)
  }
  return { south: i0 / PER_DEG, west: j0 / PER_DEG, north: (i1 + 1) / PER_DEG, east: (j1 + 1) / PER_DEG }
}

/** Rough distance in metres from a point to the nearest part of a cell (0 inside). */
export function cellDistanceM(c: CellId, p: LatLon): number {
  const b = cellBBox(c)
  const dLat = p.lat < b.south ? b.south - p.lat : p.lat > b.north ? p.lat - b.north : 0
  const dLon = p.lon < b.west ? b.west - p.lon : p.lon > b.east ? p.lon - b.east : 0
  const k = Math.cos((p.lat * Math.PI) / 180)
  return Math.hypot(dLat * M_PER_DEG_LAT, dLon * M_PER_DEG_LAT * k)
}

/** Nearest to `p` first; ties follow the distance to the cell centre, then the indices, so the order is stable. */
export function nearestFirst(cells: readonly CellId[], p: LatLon): CellId[] {
  const near = new Map<string, [number, number]>()
  for (const c of cells) near.set(cellKey(c), [cellDistanceM(c, p), distanceToCentre(c, p)])
  return [...cells].sort((a, b) => {
    const da = near.get(cellKey(a))!
    const db = near.get(cellKey(b))!
    return da[0] - db[0] || da[1] - db[1] || a.i - b.i || a.j - b.j
  })
}

/** Tie-break: of two cells that both contain or touch the point, prefer the one whose centre is closer. */
function distanceToCentre(c: CellId, p: LatLon): number {
  const m = cellCentre(c)
  const k = Math.cos((p.lat * Math.PI) / 180)
  return Math.hypot((m.lat - p.lat) * M_PER_DEG_LAT, (m.lon - p.lon) * M_PER_DEG_LAT * k)
}

/** The eight neighbours plus the cell itself, as keys. */
export function neighbourhood(c: CellId): CellId[] {
  const out: CellId[] = []
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push({ i: c.i + di, j: c.j + dj })
  return out
}

/**
 * Pick the next request from a nearest-first wish list: the first cell plus its neighbours that are
 * also wanted, as a rectangle of at most `max` cells (1×1, 1×2, 2×1, 2×2, ...). The rectangle holds
 * only wanted cells, so the request's bounding box never covers a cell that is not needed.
 */
export function planBatch(wanted: readonly CellId[], max = MAX_BATCH_CELLS): CellId[] {
  const first = wanted[0]
  if (!first) return []
  const want = new Map(wanted.map((c, rank) => [cellKey(c), rank]))
  let best: { cells: CellId[]; score: number } = { cells: [first], score: 0 }
  let bestSize = 1
  for (let h = 1; h <= max; h++) {
    for (let w = 1; w * h <= max; w++) {
      if (w * h < bestSize) continue
      for (let di = 0; di < h; di++) {
        for (let dj = 0; dj < w; dj++) {
          const i0 = first.i - di
          const j0 = first.j - dj
          const cells: CellId[] = []
          let rank = 0
          for (let i = i0; i < i0 + h; i++) {
            for (let j = j0; j < j0 + w; j++) {
              const r = want.get(`${i},${j}`)
              if (r === undefined) {
                cells.length = 0
                break
              }
              rank += r
              cells.push({ i, j })
            }
            if (!cells.length) break
          }
          // Larger first; of equal size the one made of the nearer cells; then a stable order.
          if (cells.length && (cells.length > bestSize || (cells.length === bestSize && rank < best.score))) {
            best = { cells, score: rank }
            bestSize = cells.length
          }
        }
      }
    }
  }
  return best.cells.sort((a, b) => want.get(cellKey(a))! - want.get(cellKey(b))!)
}
