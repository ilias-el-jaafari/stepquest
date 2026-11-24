import type { OsmData, OsmWay } from '../osm/types.ts'
import { clipSegment, rasterizeOsm, type Pt } from '../tiles/rasterize.ts'
import { Terrain, TileGrid, type TileRect } from '../tiles/grid.ts'
import { layoutTown } from '../town/layout.ts'
import { indexByChunk, type Structures, type TownLookup } from '../town/lookup.ts'
import type { House, Landmark } from '../town/types.ts'
import { cellBBox, cellsBBox, cellKey, cellOf, sameCell, type CellId } from './cells.ts'
import type { CellRecord } from './slice.ts'

/** The frame reaches this many cells from its first cell in each direction (9 × 9 cells). */
export const MAX_RADIUS_CELLS = 4
/** Tiles rasterized around a cell so roads, auto-tiles and blocks at its edge see their surroundings. */
export const APRON_TILES = 6
/** The most a building may reach past its cell's tiles and still be built whole (about 400 m). */
export const MAX_SPILL_TILES = 80

const TREE = 1
const FENCE = 2
const GATE = 4

/** The town of one cell, in frame tile coordinates, over the cell's covered rectangle. */
type TownUnit = {
  rect: TileRect
  /** `rect` grown to hold the houses of this cell's buildings that reach into a neighbour's tiles. */
  bounds: TileRect
  /** Frame tile indices outside `rect` that this unit put into `TileWorld.spill`. */
  spilled: number[]
  /** Frame tile indices outside `rect` that carry a garden tree, fence or gate of this unit's houses. */
  outside: { trees: number[]; fences: number[]; gates: number[] }
  houses: House[]
  landmarks: Landmark[]
  /** Per tile of `rect`: house / landmark index + 1 (0 = none), and TREE | FENCE | GATE bits. */
  houseAt: Int32Array
  landmarkAt: Int32Array
  flags: Uint8Array
  byChunk: Map<number, Map<number, { houses: House[]; landmarks: Landmark[] }>>
}

const chunkKeyOf = (cx: number, cy: number) => cy * (1 << 15) + cx

/** What a unit puts on a tile outside its own rectangle (a house that reaches past the cell border, its garden bits). */
type Spill = { owner: string; house?: House; flags: number }

/**
 * The owner of a building: the cell that holds the centre of its bounding box (south and west edges
 * in, north and east out), or of its `anchor` (a vector-tile building cut at a tile seam: the centre
 * of all its pieces, so every piece has the same owner).
 */
function centreCell(data: OsmData, way: OsmWay): CellId {
  if (way.anchor) return cellOf(way.anchor)
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
  return cellOf({ lat: (south + north) / 2, lon: (west + east) / 2 })
}

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
  private readonly spill = new Map<number, Spill>()

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

  /**
   * Paint one cell's record (replacing what the cell had). A `coarse` record paints tiles and tracks
   * only: no town. Returns the changed rectangle.
   *
   * A building belongs to the cell that holds the centre of its box and is laid out whole by that
   * cell, so its houses may reach into the next cell's tiles (stored as `spill`); the other cells
   * leave its tiles alone. The window is widened to hold such buildings (at most `MAX_SPILL_TILES`).
   */
  paint(rec: CellRecord, opts: { coarse?: boolean } = {}): TileRect | undefined {
    const own = this.ownedRect(rec.cell)
    const rect = this.coveredRect(rec)
    if (!own || !rect) return undefined
    const coarse = opts.coarse === true
    const before = this.dropUnit(rec.cell)
    this.grid.clearRect(own)
    const mine = coarse ? [] : rec.data.ways.filter((w) => w.kind === 'building' && w.area && sameCell(centreCell(rec.data, w), rec.cell))
    const a = coarse ? APRON_TILES : this.apronFor(rec.data, mine, rect)
    const win = this.grid.window(rect.x - a, rect.y - a, rect.w + 2 * a, rect.h + 2 * a)
    rasterizeOsm(win, rec.data)
    this.grid.copyFrom(win, rect)
    let changed = own
    if (!coarse) {
      // Landmarks and gates stay on this cell's tiles; houses go on the buildings this cell owns.
      const keepOut = new Uint8Array(win.cols * win.rows).fill(1)
      for (let y = a; y < a + rect.h; y++) keepOut.fill(0, y * win.cols + a, y * win.cols + a + rect.w)
      const scratch = this.grid.window(rect.x - a, rect.y - a, rect.w + 2 * a, rect.h + 2 * a)
      rasterizeOsm(scratch, { ...rec.data, ways: mine, pois: [], activity: [], industrial: [] })
      const housesOn = new Uint8Array(win.cols * win.rows)
      for (let i = 0; i < housesOn.length; i++) if (scratch.terrain[i] === Terrain.building && win.terrain[i] === Terrain.building) housesOn[i] = 1
      const unit = unitFrom(win, layoutTown(win, keepOut, housesOn), rect, a, this.grid.cols)
      this.units[this.slot(rec.cell)] = unit
      this.addSpill(rec.cell, unit)
      changed = union(own, unit.bounds)
    }
    // Tracks: shifted into frame tiles and clipped to the covered rectangle (each piece drawn once).
    const dx = rect.x - a
    const dy = rect.y - a
    this.rails.set(cellKey(rec.cell), clipRails(win.rails.map((l) => l.map((p) => ({ x: p.x + dx, y: p.y + dy }))), rect))
    this.changed(before ? union(changed, before) : changed)
    return changed
  }

  /** Tiles to widen the window by: the apron, or more when an owned building reaches farther out of `rect`. */
  private apronFor(data: OsmData, mine: readonly OsmWay[], rect: TileRect): number {
    let reach = 0
    for (const w of mine) {
      for (const n of w.nodes) {
        const t = this.grid.toTileXY({ lat: data.lat[n]!, lon: data.lon[n]! })
        reach = Math.max(reach, rect.x - t.x, t.x - (rect.x + rect.w), rect.y - t.y, t.y - (rect.y + rect.h))
      }
    }
    return Math.max(APRON_TILES, Math.min(MAX_SPILL_TILES, Math.ceil(reach) + 2))
  }

  /** Forget a cell's unit and its spill; returns the rectangle it covered, if it had one. */
  private dropUnit(c: CellId): TileRect | undefined {
    const unit = this.units[this.slot(c)]
    if (!unit) return undefined
    const key = cellKey(c)
    for (const i of unit.spilled) if (this.spill.get(i)?.owner === key) this.spill.delete(i)
    this.units[this.slot(c)] = undefined
    return unit.bounds
  }

  private addSpill(c: CellId, unit: TownUnit): void {
    const key = cellKey(c)
    const cols = this.grid.cols
    const own = unit.rect
    const inside = (x: number, y: number) => x >= own.x && y >= own.y && x < own.x + own.w && y < own.y + own.h
    const at = (x: number, y: number): Spill => {
      const i = y * cols + x
      let e = this.spill.get(i)
      if (!e || e.owner !== key) {
        e = { owner: key, flags: 0 }
        this.spill.set(i, e)
        unit.spilled.push(i)
      }
      return e
    }
    for (const h of unit.houses) for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) if (!inside(x, y)) at(x, y).house = h
    for (const [set, bit] of [[unit.outside.trees, TREE], [unit.outside.fences, FENCE], [unit.outside.gates, GATE]] as const) {
      for (const i of set) {
        const e = at(i % cols, Math.floor(i / cols))
        e.flags |= bit
      }
    }
  }

  /** Forget a cell's tiles, town and tracks. */
  clear(c: CellId): TileRect | undefined {
    const own = this.ownedRect(c)
    if (!own) return undefined
    const before = this.dropUnit(c)
    this.grid.clearRect(own)
    this.rails.delete(cellKey(c))
    this.changed(before ? union(own, before) : own)
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
      if (at && (at.unit.flags[at.k]! & bit) !== 0) return true
      return this.spill.size > 0 && ((this.spill.get(i)?.flags ?? 0) & bit) !== 0
    }
    return {
      houseAt: (i) => {
        const at = this.unitAt(i)
        const h = at ? at.unit.houseAt[at.k]! : 0
        if (h) return at!.unit.houses[h - 1]
        // A landmark of the cell that owns this tile wins over a house reaching in from a neighbour.
        if (at && at.unit.landmarkAt[at.k]) return undefined
        return this.spill.size > 0 ? this.spill.get(i)?.house : undefined
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
          const r = unit.bounds
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
function unitFrom(win: TileGrid, town: ReturnType<typeof layoutTown>, rect: TileRect, apron: number, frameCols: number): TownUnit {
  const dx = rect.x - apron
  const dy = rect.y - apron
  const houses = town.houses.map((h) => ({ ...h, x: h.x + dx, y: h.y + dy }))
  const landmarks = town.landmarks.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }))
  const n = rect.w * rect.h
  const houseAt = new Int32Array(n)
  const landmarkAt = new Int32Array(n)
  const flags = new Uint8Array(n)
  const frame = (wi: number) => ({ x: (wi % win.cols) + dx, y: Math.floor(wi / win.cols) + dy })
  const inRect = (x: number, y: number) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h
  const outside = { trees: [] as number[], fences: [] as number[], gates: [] as number[] }
  const flag = (set: ReadonlySet<number>, bit: number, out: number[]) => {
    for (const wi of set) {
      const { x, y } = frame(wi)
      if (inRect(x, y)) flags[(y - rect.y) * rect.w + (x - rect.x)]! |= bit
      else out.push(y * frameCols + x)
    }
  }
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const wi = win.index(x + apron, y + apron)
      const k = y * rect.w + x
      houseAt[k] = (town.houseAt[wi] ?? -1) + 1
      landmarkAt[k] = (town.landmarkAt[wi] ?? -1) + 1
    }
  }
  flag(town.trees, TREE, outside.trees)
  flag(town.fences, FENCE, outside.fences)
  flag(town.gates, GATE, outside.gates)
  // Bounds of the unit: its rectangle and every house that reaches past it.
  let x0 = rect.x
  let y0 = rect.y
  let x1 = rect.x + rect.w
  let y1 = rect.y + rect.h
  for (const h of houses) {
    x0 = Math.min(x0, h.x)
    y0 = Math.min(y0, h.y)
    x1 = Math.max(x1, h.x + h.w)
    y1 = Math.max(y1, h.y + h.h)
  }
  return { rect, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, spilled: [], houses, landmarks, houseAt, landmarkAt, flags, byChunk: new Map(), outside }
}

function union(a: TileRect, b: TileRect): TileRect {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
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
