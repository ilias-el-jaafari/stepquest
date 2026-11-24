import { bboxCenter, type LatLon } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import type { MapSource } from '../render/mapSource.ts'
import { GraphAccumulator, WalkGraph } from '../routing/graph.ts'
import { safetyContext, type SafetyContext } from '../routing/safety.ts'
import type { TileGrid, TileRect } from '../tiles/grid.ts'
import type { TownLookup } from '../town/lookup.ts'
import { cellCentre, cellDistanceM, cellKey, cellOf, neighbourhood, parseCellKey, type CellId } from './cells.ts'
import { boxArea } from './coverage.ts'
import { isComplete, sliceToCells, type CellRecord } from './slice.ts'
import { TileWorld } from './tileWorld.ts'
import { compact, WorldData } from './worldData.ts'

/** A loaded map as the app uses it. `live` is set for a streamed world, whose snapshots share one `grid`. */
export type World = { data: OsmData; grid: TileGrid; graph: WalkGraph; safety: SafetyContext; live?: LiveWorld }

/** Cells kept in memory at most (7 × 7); farther, older ones are dropped first (requirement 19.15). */
export const MAX_RESIDENT_CELLS = 49

/**
 * A streamed world: cell records merged into one map (`WorldData`), one growing walking graph and
 * one frame of tiles. Adding cells never changes what an earlier `World` snapshot holds (the snapshot's
 * data, graph and safety are copies), and the `grid` object stays the same, so a renderer and an
 * active quest keep running while the map grows. Implements `MapSource` for the renderer.
 */
export class LiveWorld implements MapSource {
  readonly tiles: TileWorld
  private readonly records = new Map<string, CellRecord>()
  private data = new WorldData()
  private acc = new GraphAccumulator()
  private readonly lastSeen = new Map<string, number>()
  private loadingRects: TileRect[] = []
  private readonly listeners = new Set<(rect: TileRect | undefined) => void>()
  private snap: World | undefined
  /** Bumped by every change of the map (not of the loading set). */
  version = 0

  constructor(centre: CellId, initial: readonly CellRecord[] = []) {
    this.tiles = new TileWorld(centre)
    this.tiles.subscribe((r) => this.emit(r))
    this.add(initial)
  }

  /** A streamed world seeded with an extract (the bundled demo, or a live area), cut into its cells. */
  static fromData(data: OsmData): LiveWorld {
    return new LiveWorld(cellOf(bboxCenter(data.bbox)), sliceToCells(data))
  }

  get grid(): TileGrid {
    return this.tiles.grid
  }

  get town(): TownLookup {
    return this.tiles.town
  }

  get cellCount(): number {
    return this.records.size
  }

  inFrame(c: CellId): boolean {
    return this.tiles.inFrame(c)
  }

  record(c: CellId): CellRecord | undefined {
    return this.records.get(cellKey(c))
  }

  /** The cell must still be fetched: in the frame, and missing or only partly covered. */
  needs(c: CellId): boolean {
    if (!this.inFrame(c)) return false
    const r = this.records.get(cellKey(c))
    return !r || !isComplete(r)
  }

  /**
   * Add records (out-of-frame ones and ones that bring nothing new are skipped). Returns the cells
   * that changed. Only appends to the merged data and the graph: ids issued earlier stay valid.
   */
  add(records: readonly CellRecord[]): CellId[] {
    const added: CellId[] = []
    let first = Infinity
    for (const rec of records) {
      if (!this.inFrame(rec.cell)) continue
      const key = cellKey(rec.cell)
      const had = this.records.get(key)
      if (had && (isComplete(had) || boxArea(rec.coverage) <= boxArea(had.coverage))) continue
      this.records.set(key, rec)
      first = Math.min(first, this.data.addRecord(rec).firstWay)
      this.tiles.paint(rec)
      added.push(rec.cell)
    }
    if (added.length) {
      this.acc.add(this.data.snapshot(), first)
      this.snap = undefined
      this.version++
    }
    return added
  }

  /**
   * The current map as an immutable `World` (built once per change). The graph and its safety weights
   * are built on first use only (planning usually runs in the worker, which builds its own from
   * `data`), from the accumulator as it is now, so a late build still matches this snapshot.
   */
  world(): World {
    if (!this.snap) {
      const data = this.data.snapshot()
      const acc = this.acc
      const mark = acc.mark()
      let graph: WalkGraph | undefined
      let safety: SafetyContext | undefined
      const grid = this.grid
      this.snap = {
        data,
        grid,
        live: this,
        get graph() {
          return (graph ??= new WalkGraph(acc, mark))
        },
        get safety() {
          return (safety ??= safetyContext(this.graph, data))
        },
      }
    }
    return this.snap
  }

  /** Cells the view touches now (for the least-recently-seen order of eviction). */
  touch(cells: readonly CellId[], now: number): void {
    for (const c of cells) if (this.records.has(cellKey(c))) this.lastSeen.set(cellKey(c), now)
  }

  /** Cells wanted but not loaded (drawn with the loading stipple); an empty list clears it. */
  setLoading(cells: readonly CellId[]): void {
    const rects: TileRect[] = []
    for (const c of cells) {
      const own = this.tiles.ownedRect(c)
      if (!own) continue
      const r = this.records.get(cellKey(c))
      const got = r && this.tiles.coveredRect(r)
      rects.push(...(got ? subtract(own, got) : [own]))
    }
    const same = rects.length === this.loadingRects.length && rects.every((r, k) => sameRect(r, this.loadingRects[k]!))
    if (same) return
    this.loadingRects = rects
    this.emit(undefined)
  }

  loading(): readonly TileRect[] {
    return this.loadingRects
  }

  subscribe(fn: (rect: TileRect | undefined) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(rect: TileRect | undefined): void {
    for (const fn of this.listeners) fn(rect)
  }

  /**
   * Keep at most `max` cells: drop the ones seen longest ago, farthest from `centre` first, but never
   * a cell in `view` or within one cell of a point of `keep` (the active route). The merged data and
   * the graph are rebuilt from the cells that stay. Returns the dropped cells.
   */
  evict(view: readonly CellId[], keep: readonly LatLon[], centre: LatLon, max = MAX_RESIDENT_CELLS): CellId[] {
    if (this.records.size <= max) return []
    const safe = new Set(view.map(cellKey))
    const route = new Set<string>()
    for (const p of keep) route.add(cellKey(cellOf(p)))
    for (const k of route) for (const n of neighbourhood(parseCellKey(k)!)) safe.add(cellKey(n))
    const candidates = [...this.records.values()]
      .filter((r) => !safe.has(cellKey(r.cell)))
      .sort((a, b) => (this.lastSeen.get(cellKey(a.cell)) ?? 0) - (this.lastSeen.get(cellKey(b.cell)) ?? 0) || cellDistanceM(b.cell, centre) - cellDistanceM(a.cell, centre))
    const dropped: CellId[] = []
    for (const r of candidates) {
      if (this.records.size <= max) break
      this.records.delete(cellKey(r.cell))
      this.lastSeen.delete(cellKey(r.cell))
      this.tiles.clear(r.cell)
      dropped.push(r.cell)
    }
    if (dropped.length) {
      this.data = compact([...this.records.values()])
      this.acc = new GraphAccumulator().add(this.data.snapshot(), 0)
      this.snap = undefined
      this.version++
    }
    return dropped
  }

  /** Where the frame is centred (its first cell). */
  get centre(): LatLon {
    return cellCentre({ i: (this.tiles.i0 + this.tiles.i1) / 2, j: (this.tiles.j0 + this.tiles.j1) / 2 })
  }
}

const sameRect = (a: TileRect, b: TileRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** `outer` minus `inner` (inner inside outer) as up to four rectangles. */
export function subtract(outer: TileRect, inner: TileRect): TileRect[] {
  const out: TileRect[] = []
  const ox1 = outer.x + outer.w
  const oy1 = outer.y + outer.h
  const ix1 = inner.x + inner.w
  const iy1 = inner.y + inner.h
  if (inner.y > outer.y) out.push({ x: outer.x, y: outer.y, w: outer.w, h: inner.y - outer.y })
  if (iy1 < oy1) out.push({ x: outer.x, y: iy1, w: outer.w, h: oy1 - iy1 })
  if (inner.x > outer.x) out.push({ x: outer.x, y: inner.y, w: inner.x - outer.x, h: inner.h })
  if (ix1 < ox1) out.push({ x: ix1, y: inner.y, w: ox1 - ix1, h: inner.h })
  return out.filter((r) => r.w > 0 && r.h > 0)
}
