import { bboxCenter, type LatLon } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import type { FrontierEdge, MapSource } from '../render/mapSource.ts'
import { GraphAccumulator, WalkGraph } from '../routing/graph.ts'
import { safetyContext, type SafetyContext } from '../routing/safety.ts'
import type { TileGrid, TileRect } from '../tiles/grid.ts'
import type { TownLookup } from '../town/lookup.ts'
import { cellCentre, cellDistanceM, cellKey, cellOf, neighbourhood, parseCellKey, type CellId } from './cells.ts'
import { boxArea } from './coverage.ts'
import { isComplete, sliceToCells, type CellRecord } from './slice.ts'
import { TileWorld } from './tileWorld.ts'
import { matchTags } from './enrich.ts'
import { compact, WorldData } from './worldData.ts'

/** A loaded map as the app uses it. `live` is set for a streamed world, whose snapshots share one `grid` until the frame moves. */
export type World = { data: OsmData; grid: TileGrid; graph: WalkGraph; safety: SafetyContext; live?: LiveWorld }

/** Cells kept in memory at most per kind of record (7 × 7); farther, older ones are dropped first (requirement 19.15). */
export const MAX_RESIDENT_CELLS = 49

type Paint = { rec: CellRecord; coarse: boolean }

/**
 * A streamed world. Three kinds of cell record:
 * - graph records (the bundled extract, Overpass cells): merged into one map (`WorldData`) and one
 *   growing walking graph, and drawn where nothing better is there;
 * - drawn records (vector-tile detail, requirement 21): tiles and town only;
 * - coarse records (low-zoom vector tiles): tiles only, the placeholder.
 * A cell paints, in this order of preference: a complete graph record, a drawn record, a coarse record,
 * a partial graph record (`best`); only a whole-cell record counts as covered (`hasAny`). Adding cells never changes what an earlier `World` snapshot holds,
 * so a renderer and an active quest keep running while the map grows. Implements `MapSource`.
 */
export class LiveWorld implements MapSource {
  /** The drawn frame. Replaced by `recentre` when the view leaves it (requirement 20.17); the data and graph are kept. */
  tiles: TileWorld
  private stopTiles: () => void
  /** Cells whose best record is not painted into the current frame yet (after a `recentre`); they count as not covered. */
  private readonly unpainted = new Set<string>()
  /** Cells that show an older record than their best one (after `setWide`); their old paint still counts. */
  private readonly repaint = new Set<string>()
  private readonly frameListeners = new Set<() => void>()
  /** Bumped by every `recentre`. */
  frameVersion = 0
  private readonly records = new Map<string, CellRecord>()
  /** Walking records (vector-tile streets, requirement 23): in the data and the graph, never painted. */
  private readonly walk = new Map<string, CellRecord>()
  /** Overpass cells that enriched a walking record, kept so a rebuilt map gets the tags again. */
  private readonly enriched = new Map<string, CellRecord>()
  private walkSeq = 0
  private readonly drawn = new Map<string, CellRecord>()
  private readonly coarse = new Map<string, CellRecord>()
  /** What each cell of the frame shows now. */
  private readonly painted = new Map<string, CellRecord>()
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
    this.stopTiles = this.tiles.subscribe((r) => this.emit(r))
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

  /** Graph records held. */
  get cellCount(): number {
    return this.records.size
  }

  inFrame(c: CellId): boolean {
    return this.tiles.inFrame(c)
  }

  /** The cell the frame is centred on. */
  get anchor(): CellId {
    return { i: (this.tiles.i0 + this.tiles.i1) / 2, j: (this.tiles.j0 + this.tiles.j1) / 2 }
  }

  /** The view is at or below `FAR_ZOOM`: the coarse layer paints every cell that has one (requirement 21.7). */
  private wide = false

  /**
   * Switch between the far-zoom look (coarse tiles everywhere they exist) and the close look. The
   * cells whose best record changes are queued for `paintNext`; until then they keep their old paint
   * (still a whole-cell picture, so readiness does not drop).
   */
  setWide(wide: boolean): void {
    if (wide === this.wide) return
    this.wide = wide
    for (const k of this.painted.keys()) if (this.best(k)?.rec !== this.painted.get(k)) this.repaint.add(k)
  }

  private best(k: string): Paint | undefined {
    if (this.wide) {
      const coarse = this.coarse.get(k)
      if (coarse) return { rec: coarse, coarse: true }
    }
    const rec = this.records.get(k)
    if (rec && isComplete(rec)) return { rec, coarse: false }
    const drawn = this.drawn.get(k)
    if (drawn) return { rec: drawn, coarse: false }
    // A whole-cell tile record beats a graph record that covers only part of the cell (requirement 21.7).
    const coarse = this.coarse.get(k)
    if (coarse) return { rec: coarse, coarse: true }
    return rec ? { rec, coarse: false } : undefined
  }

  /** Paint the cell's best record if it is not what the cell shows. Returns whether the tiles changed. */
  private refresh(k: string): boolean {
    const cell = parseCellKey(k)!
    if (!this.inFrame(cell)) return false
    this.unpainted.delete(k)
    this.repaint.delete(k)
    const b = this.best(k)
    if (!b) {
      if (!this.painted.has(k)) return false
      this.painted.delete(k)
      this.tiles.clear(cell)
      return true
    }
    if (this.painted.get(k) === b.rec) return false
    this.tiles.paint(b.rec, { coarse: b.coarse })
    this.painted.set(k, b.rec)
    return true
  }

  /** The cell still lacks detail: no complete graph record and no drawn record (in the frame only). */
  needs(c: CellId): boolean {
    if (!this.inFrame(c)) return false
    const k = cellKey(c)
    const r = this.records.get(k)
    return !(r && isComplete(r)) && !this.drawn.has(k)
  }

  /** The cell has no complete graph record (the walking graph does not cover it). */
  needsGraph(c: CellId): boolean {
    if (!this.inFrame(c)) return false
    const k = cellKey(c)
    if (this.walk.has(k)) return false
    const r = this.records.get(k)
    return !r || !isComplete(r)
  }

  /** The cell is in the walking graph: a graph record (also a partial one, as at the edge of the bundled extract) or a walking record. */
  hasGraph(c: CellId): boolean {
    const k = cellKey(c)
    return this.records.has(k) || this.walk.has(k)
  }

  /** The whole cell is painted now (requirement 21.14): a record that covers only part of it does not count. */
  hasAny(c: CellId): boolean {
    if (!this.inFrame(c)) return false
    const r = this.painted.get(cellKey(c))
    return r !== undefined && isComplete(r)
  }

  /** The cell has its coarse record (the far-zoom look needs one for every visible cell). */
  hasCoarse(c: CellId): boolean {
    return this.coarse.has(cellKey(c))
  }

  /** No whole-cell record is there, so the coarse layer would fill the cell (also next to a partial graph record). */
  needsCoarse(c: CellId): boolean {
    if (!this.inFrame(c)) return false
    const k = cellKey(c)
    const r = this.records.get(k)
    return !this.coarse.has(k) && !this.drawn.has(k) && !(r && isComplete(r))
  }

  private commit(changed: CellId[]): CellId[] {
    if (changed.length) {
      this.version++
      this.emit(undefined)
    }
    return changed
  }

  /** Add coarse records (requirement 21.4): tiles only. Kept as the fall-back of their cell. Returns the cells painted. */
  addCoarse(records: readonly CellRecord[]): CellId[] {
    const painted: CellId[] = []
    for (const rec of records) {
      if (!this.inFrame(rec.cell)) continue
      const k = cellKey(rec.cell)
      if (this.coarse.has(k)) continue
      this.coarse.set(k, rec)
      if (this.refresh(k)) painted.push(rec.cell)
    }
    return this.commit(painted)
  }

  /** Add drawn records (vector-tile detail, requirement 21.5): tiles and town, never data or graph. Returns the cells painted. */
  addDrawn(records: readonly CellRecord[]): CellId[] {
    const painted: CellId[] = []
    for (const rec of records) {
      if (!this.inFrame(rec.cell)) continue
      const k = cellKey(rec.cell)
      this.drawn.set(k, rec)
      if (this.refresh(k)) painted.push(rec.cell)
    }
    return this.commit(painted)
  }

  /**
   * Add graph records (out-of-frame ones and ones that bring nothing new are skipped). Returns the
   * cells whose graph record changed. Only appends to the merged data and the graph: ids issued
   * earlier stay valid. A cell already drawn from vector tiles keeps that drawing unless the record is complete.
   */
  add(records: readonly CellRecord[]): CellId[] {
    const added: CellId[] = []
    let first = Infinity
    for (const rec of records) {
      if (!this.inFrame(rec.cell)) continue
      const key = cellKey(rec.cell)
      if (this.walk.has(key) && !this.records.has(key)) {
        // The streets of this cell come from tiles: Overpass only adds tags (requirement 23.5).
        if (rec.data.source !== 'fixture') this.enrich([rec])
        continue
      }
      const had = this.records.get(key)
      if (had && (isComplete(had) || boxArea(rec.coverage) <= boxArea(had.coverage))) continue
      this.records.set(key, rec)
      first = Math.min(first, this.data.addRecord(rec).firstWay)
      this.refresh(key)
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
   * Add walking records (requirement 23.1): the streets of cells that have no graph record yet, built
   * from vector tiles. They enter the merged data and the graph like any graph record, with way ids
   * made unique per call so two loads never join their ways by accident, and are never painted.
   * Out-of-frame cells and cells that already have a graph record are skipped. Returns the cells added.
   */
  addWalkNet(records: readonly CellRecord[]): CellId[] {
    const added: CellId[] = []
    let first = Infinity
    const seq = ++this.walkSeq
    for (const rec of records) {
      const key = cellKey(rec.cell)
      if (!this.inFrame(rec.cell) || this.records.has(key) || this.walk.has(key)) continue
      const own: CellRecord = { ...rec, data: { ...rec.data, ways: rec.data.ways.map((w) => ({ ...w, id: seq * 1_000_000 + w.id })) } }
      this.walk.set(key, own)
      first = Math.min(first, this.data.addRecord(own).firstWay)
      added.push(rec.cell)
    }
    if (added.length) {
      this.acc.add(this.data.snapshot(), first)
      for (const c of added) {
        const e = this.enriched.get(cellKey(c))
        if (e) this.applyTags(e)
      }
      this.snap = undefined
      this.version++
    }
    return added
  }

  /**
   * Enrich walking records from Overpass cells (requirement 23.5): tags only, geometry never changes.
   * Their activity points and industrial rings join the data too. Makes a new snapshot when anything
   * changed. Returns the number of ways that got tags.
   */
  enrich(records: readonly CellRecord[]): number {
    let tagged = 0
    let extras = false
    for (const rec of records) {
      const key = cellKey(rec.cell)
      if (!this.walk.has(key) || this.enriched.has(key)) continue
      this.enriched.set(key, rec)
      tagged += this.applyTags(rec)
      const extra = { ...rec, data: { ...rec.data, ways: [], pois: [], source: 'tiles' as const } }
      if ((rec.data.activity?.length ?? 0) + (rec.data.industrial?.length ?? 0) > 0) {
        this.data.addRecord(extra)
        extras = true
      }
    }
    if (tagged || extras) {
      // Same graph (no new edges), new data: the safety context is built again from the tagged ways.
      this.acc.add(this.data.snapshot(), this.data.ways.length)
      this.snap = undefined
      this.version++
    }
    return tagged
  }

  private applyTags(rec: CellRecord): number {
    const matches = matchTags(this.data, this.data.tileWays, rec.data)
    let n = 0
    for (const [index, tags] of matches) if (this.data.retag(index, tags)) n++
    return n
  }

  /**
   * The current map as an immutable `World` (built once per change). The graph and its safety weights
   * are built on first use only, from the accumulator as it is now, so a late build still matches.
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

  /**
   * Move the frame so it is centred on `c` (requirement 20.17). Graph records, the merged data and the
   * walking graph stay; drawn and coarse records outside the new frame are forgotten (they come back
   * from the cache). Nothing is painted here: call `paintNext` until it returns undefined. Frame
   * listeners hear the change at once, so the map view can rebuild its renderer on the new grid.
   */
  recentre(c: CellId): void {
    if (c.i === this.anchor.i && c.j === this.anchor.j) return
    this.stopTiles()
    this.tiles = new TileWorld(c)
    this.stopTiles = this.tiles.subscribe((r) => this.emit(r))
    for (const m of [this.drawn, this.coarse]) for (const k of [...m.keys()]) if (!this.tiles.inFrame(parseCellKey(k)!)) m.delete(k)
    this.painted.clear()
    this.unpainted.clear()
    this.repaint.clear()
    for (const k of new Set([...this.records.keys(), ...this.drawn.keys(), ...this.coarse.keys()])) if (this.tiles.inFrame(parseCellKey(k)!)) this.unpainted.add(k)
    this.loadingRects = []
    this.snap = undefined
    this.version++
    this.frameVersion++
    for (const fn of this.frameListeners) fn()
  }

  /**
   * Paint the waiting cell nearest to `p` (after a `recentre` or a `setWide`); with `only`, only among
   * those cell keys (the visible cells go first). Returns the cell, or undefined when none is left.
   */
  paintNext(p: LatLon, only?: ReadonlySet<string>): CellId | undefined {
    let best: string | undefined
    let bestD = Infinity
    for (const set of [this.unpainted, this.repaint]) {
      for (const k of set) {
        if (only && !only.has(k)) continue
        const d = cellDistanceM(parseCellKey(k)!, p)
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
    }
    if (best === undefined) return undefined
    this.refresh(best)
    this.version++
    return parseCellKey(best)!
  }

  /** Hear a `recentre` (the grid object changed). Returns the unsubscribe. */
  subscribeFrame(fn: () => void): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  /** Cells the view touches now (for the least-recently-seen order of eviction). */
  touch(cells: readonly CellId[], now: number): void {
    for (const c of cells) {
      const k = cellKey(c)
      if (this.records.has(k) || this.drawn.has(k)) this.lastSeen.set(k, now)
    }
  }

  /** Cells wanted but with nothing painted (drawn with the loading stipple); an empty list clears it. */
  setLoading(cells: readonly CellId[]): void {
    const rects: TileRect[] = []
    for (const c of cells) {
      const own = this.tiles.ownedRect(c)
      if (!own) continue
      const shown = this.painted.get(cellKey(c))
      const got = shown && this.tiles.coveredRect(shown)
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

  private frontierAt = -1
  private frontierEdges: FrontierEdge[] = []

  /**
   * Straight edges of what is painted that face ground with nothing painted: a covered rectangle's
   * side whose neighbour shows nothing whole (missing, partly covered, or outside the frame), or that
   * lies inside its own cell (a partly covered record). Cached per `version`.
   */
  frontier(): readonly FrontierEdge[] {
    if (this.frontierAt === this.version) return this.frontierEdges
    const out: FrontierEdge[] = []
    const solid = (c: CellId) => {
      const r = this.painted.get(cellKey(c))
      return r !== undefined && isComplete(r)
    }
    for (const rec of this.painted.values()) {
      const own = this.tiles.ownedRect(rec.cell)
      const r = own && this.tiles.coveredRect(rec)
      if (!own || !r) continue
      const { i, j } = rec.cell
      if (r.x > own.x || !solid({ i, j: j - 1 })) out.push({ side: 'w', x: r.x, y: r.y, len: r.h })
      if (r.x + r.w < own.x + own.w || !solid({ i, j: j + 1 })) out.push({ side: 'e', x: r.x + r.w, y: r.y, len: r.h })
      if (r.y > own.y || !solid({ i: i + 1, j })) out.push({ side: 'n', x: r.x, y: r.y, len: r.w })
      if (r.y + r.h < own.y + own.h || !solid({ i: i - 1, j })) out.push({ side: 's', x: r.x, y: r.y + r.h, len: r.w })
    }
    this.frontierEdges = out
    this.frontierAt = this.version
    return out
  }

  subscribe(fn: (rect: TileRect | undefined) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(rect: TileRect | undefined): void {
    for (const fn of this.listeners) fn(rect)
  }

  /**
   * Keep at most `max` graph records and `max` drawn records: drop the ones seen longest ago,
   * farthest from `centre` first, but never a cell in `view`; graph records within one cell of a
   * point of `keep` (the active route) are never dropped either. A dropped cell shows its next best
   * record (a drawn record, else coarse). Returns the dropped cells.
   */
  evict(view: readonly CellId[], keep: readonly LatLon[], centre: LatLon, max = MAX_RESIDENT_CELLS): CellId[] {
    const inView = new Set(view.map(cellKey))
    const route = new Set<string>()
    for (const p of keep) for (const n of neighbourhood(cellOf(p))) route.add(cellKey(n))
    const order = (m: Map<string, CellRecord>, safe: (k: string) => boolean) =>
      [...m.values()]
        .filter((r) => !safe(cellKey(r.cell)))
        .sort((a, b) => (this.lastSeen.get(cellKey(a.cell)) ?? 0) - (this.lastSeen.get(cellKey(b.cell)) ?? 0) || cellDistanceM(b.cell, centre) - cellDistanceM(a.cell, centre))
    const dropped: CellId[] = []
    if (this.records.size > max) {
      let gone = 0
      for (const r of order(this.records, (k) => inView.has(k) || route.has(k))) {
        if (this.records.size <= max) break
        const k = cellKey(r.cell)
        this.records.delete(k)
        if (!this.drawn.has(k)) this.lastSeen.delete(k)
        this.refresh(k)
        dropped.push(r.cell)
        gone++
      }
      if (gone) {
        this.data = compact([...this.records.values(), ...this.walk.values()])
        for (const rec of this.enriched.values()) this.applyTags(rec)
        this.acc = new GraphAccumulator().add(this.data.snapshot(), 0)
        this.snap = undefined
      }
    }
    if (this.drawn.size > max) {
      for (const r of order(this.drawn, (k) => inView.has(k))) {
        if (this.drawn.size <= max) break
        const k = cellKey(r.cell)
        this.drawn.delete(k)
        if (!this.records.has(k)) this.lastSeen.delete(k)
        this.refresh(k)
        dropped.push(r.cell)
      }
    }
    if (dropped.length) this.version++
    return dropped
  }

  /** Where the frame is centred (its first cell). */
  get centre(): LatLon {
    return cellCentre(this.anchor)
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
