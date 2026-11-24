import { clipSegment, rasterizeOsm, type Pt } from '../tiles/rasterize.ts'
import { TileGrid, type TileRect } from '../tiles/grid.ts'
import { layoutTown } from '../town/layout.ts'
import { indexByChunk, type Structures, type TownLookup } from '../town/lookup.ts'
import type { House, Landmark } from '../town/types.ts'
import { cellBBox, cellsBBox, cellKey, type CellId } from './cells.ts'
import type { CellRecord } from './slice.ts'

/** The frame reaches this many cells from its first cell in each direction (9 × 9 cells). */
export const MAX_RADIUS_CELLS = 4
/** Tiles rasterized around a cell so roads, auto-tiles and blocks at its edge see their surroundings. */
export const APRON_TILES = 6

const TREE = 1
const FENCE = 2
const GATE = 4

/** The town of one cell, in frame tile coordinates, over the cell's covered rectangle. */
type TownUnit = {
  rect: TileRect
  houses: House[]
  landmarks: Landmark[]
  /** Per tile of `rect`: house / landmark index + 1 (0 = none), and TREE | FENCE | GATE bits. */
  houseAt: Int32Array
  landmarkAt: Int32Array
  flags: Uint8Array
  byChunk: Map<number, Map<number, { houses: House[]; landmarks: Landmark[] }>>
}

const chunkKeyOf = (cx: number, cy: number) => cy * (1 << 15) + cx

/**
 * The tiles and town of a streamed world. One frame grid (9 × 9 cells around the first cell, one
 * projection) holds every cell; a cell owns the tile columns and rows between its rounded borders, so
 * the cells partition the frame. A cell is rasterized from its own data into a window of the frame
 * with an apron, and only its covered rectangle is copied in, so its tiles do not depend on which
 * neighbours are loaded. Its town is laid out on the same window with the apron kept out, so houses
 * and landmarks of two cells never overlap. Listeners hear the tile rectangle that changed.
 */
export class TileWorld {
  readonly grid: TileGrid
  /** Frame cells, inclusive. */
  readonly i0: number
  readonly i1: number
  readonly j0: number
  readonly j1: number
  readonly town: TownLookup
  private readonly xs: number[]
  private readonly ys: number[]
  private readonly colCell: Int16Array
  private readonly rowCell: Int16Array
  private readonly units: (TownUnit | undefined)[]
  private readonly rails = new Map<string, Pt[][]>()
  private readonly listeners = new Set<(rect: TileRect) => void>()
  private structureCache = new Map<number, Map<number, Structures | undefined>>()

  constructor(centre: CellId, metresPerTile?: number) {
    const r = MAX_RADIUS_CELLS
    this.i0 = centre.i - r
    this.i1 = centre.i + r
    this.j0 = centre.j - r
    this.j1 = centre.j + r
    this.grid = new TileGrid(cellsBBox([{ i: this.i0, j: this.j0 }, { i: this.i1, j: this.j1 }]), metresPerTile)
    this.grid.covered = new Uint8Array(this.grid.cols * this.grid.rows)
    const north = this.grid.bbox.north
    const west = this.grid.bbox.west
    // Column borders west to east (j0 .. j1 + 1), row borders north to south (i1 + 1 .. i0).
    this.xs = []
    for (let j = this.j0; j <= this.j1 + 1; j++) this.xs.push(Math.min(this.grid.cols, Math.round(this.grid.toTileXY({ lat: north, lon: j / 100 }).x)))
    this.ys = []
    for (let i = this.i1 + 1; i >= this.i0; i--) this.ys.push(Math.min(this.grid.rows, Math.round(this.grid.toTileXY({ lat: i / 100, lon: west }).y)))
    this.xs[this.xs.length - 1] = this.grid.cols
    this.ys[this.ys.length - 1] = this.grid.rows
    this.colCell = new Int16Array(this.grid.cols)
    for (let k = 0; k < this.xs.length - 1; k++) this.colCell.fill(k, this.xs[k]!, this.xs[k + 1]!)
    this.rowCell = new Int16Array(this.grid.rows)
    for (let k = 0; k < this.ys.length - 1; k++) this.rowCell.fill(k, this.ys[k]!, this.ys[k + 1]!)
    this.units = new Array((2 * r + 1) * (2 * r + 1))
    this.town = this.lookup()
  }

  inFrame(c: CellId): boolean {
    return c.i >= this.i0 && c.i <= this.i1 && c.j >= this.j0 && c.j <= this.j1
  }

  private slot(c: CellId): number {
    return (this.i1 - c.i) * (this.j1 - this.j0 + 1) + (c.j - this.j0)
  }

  /** The tiles a cell owns, or undefined outside the frame. */
  ownedRect(c: CellId): TileRect | undefined {
    if (!this.inFrame(c)) return undefined
    const kx = c.j - this.j0
    const ky = this.i1 - c.i
    const x = this.xs[kx]!
    const y = this.ys[ky]!
    return { x, y, w: this.xs[kx + 1]! - x, h: this.ys[ky + 1]! - y }
  }

  /** The part of a cell's rectangle that a record covers (all of it for a whole cell). */
  coveredRect(rec: Pick<CellRecord, 'cell' | 'coverage'>): TileRect | undefined {
    const own = this.ownedRect(rec.cell)
    if (!own) return undefined
    const whole = cellBBox(rec.cell)
    const eps = 1e-9
    const nw = this.grid.toTileXY({ lat: rec.coverage.north, lon: rec.coverage.west })
    const se = this.grid.toTileXY({ lat: rec.coverage.south, lon: rec.coverage.east })
    // Keep the exact owned borders where the record reaches the cell border, so cells still tile the frame.
    const x0 = rec.coverage.west <= whole.west + eps ? own.x : Math.max(own.x, Math.round(nw.x))
    const y0 = rec.coverage.north >= whole.north - eps ? own.y : Math.max(own.y, Math.round(nw.y))
    const x1 = rec.coverage.east >= whole.east - eps ? own.x + own.w : Math.min(own.x + own.w, Math.round(se.x))
    const y1 = rec.coverage.south <= whole.south + eps ? own.y + own.h : Math.min(own.y + own.h, Math.round(se.y))
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
  }

  /** Paint one cell's record (replacing what the cell had). Returns the changed rectangle. */
  paint(rec: CellRecord): TileRect | undefined {
    const own = this.ownedRect(rec.cell)
    const rect = this.coveredRect(rec)
    if (!own || !rect) return undefined
    this.grid.clearRect(own)
    const a = APRON_TILES
    const win = this.grid.window(rect.x - a, rect.y - a, rect.w + 2 * a, rect.h + 2 * a)
    rasterizeOsm(win, rec.data)
    this.grid.copyFrom(win, rect)
    // The town: nothing is built outside the covered rectangle.
    const keepOut = new Uint8Array(win.cols * win.rows).fill(1)
    for (let y = a; y < a + rect.h; y++) keepOut.fill(0, y * win.cols + a, y * win.cols + a + rect.w)
    this.units[this.slot(rec.cell)] = unitFrom(win, layoutTown(win, keepOut), rect, a)
    // Tracks: shifted into frame tiles and clipped to the covered rectangle (each piece drawn once).
    const dx = rect.x - a
    const dy = rect.y - a
    this.rails.set(cellKey(rec.cell), clipRails(win.rails.map((l) => l.map((p) => ({ x: p.x + dx, y: p.y + dy }))), rect))
    this.changed(own)
    return own
  }

  /** Forget a cell's tiles, town and tracks. */
  clear(c: CellId): TileRect | undefined {
    const own = this.ownedRect(c)
    if (!own) return undefined
    this.grid.clearRect(own)
    this.units[this.slot(c)] = undefined
    this.rails.delete(cellKey(c))
    this.changed(own)
    return own
  }

  subscribe(fn: (rect: TileRect) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(rect: TileRect): void {
    this.grid.rails = [...this.rails.values()].flat()
    this.structureCache = new Map()
    // One tile more on each side: auto-tiles and kerbs of the neighbours read across the border.
    const r = { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 }
    for (const fn of this.listeners) fn(r)
  }

  private unitAt(i: number): { unit: TownUnit; k: number } | undefined {
    const cols = this.grid.cols
    const x = i % cols
    const y = (i - x) / cols
    const unit = this.units[this.rowCell[y]! * (this.j1 - this.j0 + 1) + this.colCell[x]!]
    if (!unit) return undefined
    const lx = x - unit.rect.x
    const ly = y - unit.rect.y
    if (lx < 0 || ly < 0 || lx >= unit.rect.w || ly >= unit.rect.h) return undefined
    return { unit, k: ly * unit.rect.w + lx }
  }

  private lookup(): TownLookup {
    const flag = (bit: number) => (i: number) => {
      const at = this.unitAt(i)
      return !!at && (at.unit.flags[at.k]! & bit) !== 0
    }
    return {
      houseAt: (i) => {
        const at = this.unitAt(i)
        const h = at ? at.unit.houseAt[at.k]! : 0
        return h ? at!.unit.houses[h - 1] : undefined
      },
      landmarkAt: (i) => {
        const at = this.unitAt(i)
        const l = at ? at.unit.landmarkAt[at.k]! : 0
        return l ? at!.unit.landmarks[l - 1] : undefined
      },
      hasTree: flag(TREE),
      hasFence: flag(FENCE),
      hasGate: flag(GATE),
      structuresIn: (cx, cy, size) => {
        let bySize = this.structureCache.get(size)
        if (!bySize) this.structureCache.set(size, (bySize = new Map()))
        const key = chunkKeyOf(cx, cy)
        if (bySize.has(key)) return bySize.get(key)
        const houses: House[] = []
        const landmarks: Landmark[] = []
        const x0 = cx * size
        const y0 = cy * size
        for (const unit of this.units) {
          if (!unit) continue
          const r = unit.rect
          if (r.x >= x0 + size || r.x + r.w <= x0 || r.y >= y0 + size || r.y + r.h <= y0) continue
          let index = unit.byChunk.get(size)
          if (!index) unit.byChunk.set(size, (index = indexByChunk(unit.houses, unit.landmarks, size, chunkKeyOf)))
          const e = index.get(key)
          if (e) {
            houses.push(...e.houses)
            landmarks.push(...e.landmarks)
          }
        }
        const out = houses.length || landmarks.length ? { houses, landmarks } : undefined
        bySize.set(key, out)
        return out
      },
    }
  }
}

/** Convert a window layout into a unit over `rect` (frame tiles); the window starts `apron` tiles before it. */
function unitFrom(win: TileGrid, town: ReturnType<typeof layoutTown>, rect: TileRect, apron: number): TownUnit {
  const dx = rect.x - apron
  const dy = rect.y - apron
  const houses = town.houses.map((h) => ({ ...h, x: h.x + dx, y: h.y + dy }))
  const landmarks = town.landmarks.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }))
  const n = rect.w * rect.h
  const houseAt = new Int32Array(n)
  const landmarkAt = new Int32Array(n)
  const flags = new Uint8Array(n)
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const wi = win.index(x + apron, y + apron)
      const k = y * rect.w + x
      houseAt[k] = (town.houseAt[wi] ?? -1) + 1
      landmarkAt[k] = (town.landmarkAt[wi] ?? -1) + 1
      flags[k] = (town.trees.has(wi) ? TREE : 0) | (town.fences.has(wi) ? FENCE : 0) | (town.gates.has(wi) ? GATE : 0)
    }
  }
  return { rect, houses, landmarks, houseAt, landmarkAt, flags, byChunk: new Map() }
}

/** Clip polylines to a rectangle; pieces that leave and come back become separate polylines. */
export function clipRails(lines: readonly Pt[][], r: TileRect): Pt[][] {
  const out: Pt[][] = []
  for (const line of lines) {
    let cur: Pt[] | undefined
    for (let k = 1; k < line.length; k++) {
      const seg = clipSegment(line[k - 1]!, line[k]!, r.x, r.y, r.x + r.w, r.y + r.h)
      if (!seg) {
        cur = undefined
        continue
      }
      const [a, b] = seg
      const last = cur?.[cur.length - 1]
      if (!cur || !last || last.x !== a.x || last.y !== a.y) out.push((cur = [a]))
      cur.push(b)
    }
  }
  return out
}
