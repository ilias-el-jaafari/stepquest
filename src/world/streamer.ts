import type { BBox, LatLon } from '../geo/geo.ts'
import { haversine } from '../geo/geo.ts'
import type { OverpassClient, OverpassErrorCode } from '../osm/overpass.ts'
import { OverpassError } from '../osm/overpass.ts'
import type { OsmData } from '../osm/types.ts'
import { FAR_ZOOM } from '../render/camera.ts'
import { cellFromTiles, COARSE_Z, DETAIL_Z, tilesForCell, type LoadedTile } from '../vector/assemble.ts'
import type { TileSource } from '../vector/client.ts'
import { TileError, type TileErrorCode } from '../vector/fetchTile.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { cellKey, cellOf, cellsInBBox, nearestFirst, planBatch, type CellId } from './cells.ts'
import type { LiveWorld } from './liveWorld.ts'
import type { CellRecord } from './slice.ts'

/** The view must rest this long before tiles are requested from the network (cached data shows at once). */
export const SETTLE_MS = 400
/** Tile downloads at once (requirement 21.8); equal to the client's `MAX_TILES_IN_FLIGHT`. */
export const MAX_TILE_CONCURRENT = 6
/** A safety net, not a pace: at most this many tile downloads start in any 60 s (a full phone view needs about 8). */
export const MAX_TILES_PER_MINUTE = 60
export const MINUTE_MS = 60_000
/** After a failure a tile waits about this long (±25 %), doubling per failure up to BACKOFF_MAX_MS. */
export const BACKOFF_START_MS = 2_000
export const BACKOFF_MAX_MS = 60_000
/** A 429 from the tile server pauses every tile start for at least this long (jittered). */
export const RATE_LIMIT_PAUSE_MS = 30_000
/** Graph cells (Overpass) back off on their own clock: 4 s doubling to 2 min. */
export const GRAPH_BACKOFF_START_MS = 4_000
export const GRAPH_BACKOFF_MAX_MS = 2 * 60_000
/** Graph cells per request. */
export const GRAPH_BATCH = 2
/** The route ahead of the view that is loaded in advance (requirement 21.9). */
export const AHEAD_M = 1_200
export const AHEAD_MAX_CELLS = 6
/** Decoded tiles kept in memory for assembling cells (more when the view needs more). */
export const MAX_RESIDENT_TILES = 16
/** A unit whose client never answers is given up on after this long (the clients have their own, shorter, deadlines). */
export const UNIT_WATCHDOG_MS = 40_000
/** A view this zoomed out asks for nothing beyond the frame anyway; this caps the list per view. */
const MAX_VIEW_CELLS = 81

/** What the map shows now (requirement 20.15, unchanged by 21). */
export type MapLoad = {
  /** `full`: every cell in view has what this zoom needs; `coarse`: every cell has at least the coarse layer; `loading`: some cell has nothing. */
  ready: 'loading' | 'coarse' | 'full'
  /** View cells that still lack what this zoom needs. */
  pending: number
}

export const IDLE_LOAD: MapLoad = { ready: 'full', pending: 0 }

/** The Overpass side: only the walking graph (requirement 21.10). */
export type GraphClient = Pick<OverpassClient, 'loadCells' | 'cachedCell' | 'busy' | 'waitMs'>
export type StreamTarget = Pick<LiveWorld, 'needs' | 'needsGraph' | 'needsCoarse' | 'hasAny' | 'add' | 'addDrawn' | 'addCoarse' | 'setLoading' | 'touch' | 'evict' | 'inFrame' | 'recentre' | 'paintNext' | 'anchor'>

export type StreamerOptions = {
  /** Vector tiles: everything the map draws. */
  tiles: TileSource
  /** Overpass cells for the walking graph along the route; optional (the planner's area download covers the start). */
  graph?: GraphClient
  world: StreamTarget
  /** False while the device is offline: cached data still loads, nothing is requested. */
  online?: () => boolean
  now?: () => number
  /** 0 to 1, for the back-off jitter. */
  random?: () => number
  /** Points of the active route: cells near them are never evicted, and the part ahead of the view is loaded in advance. */
  keep?: () => readonly LatLon[]
  /** Cells were added to the world (the app takes a new snapshot). */
  onChange?: (cells: CellId[]) => void
  /** A download failed (the unit waits for its back-off). */
  onError?: (code: OverpassErrorCode | TileErrorCode) => void
  /** The load state changed. */
  onLoad?: (load: MapLoad) => void
  /** Whether the frame may move to follow the view (requirement 20.17): true while a route is planned or a quest runs. */
  reanchor?: () => boolean
  /** The frame moved (the grid object changed). */
  onFrame?: () => void
}

/** Back-off after `failures` failures in a row, before jitter. */
export function backoffMs(failures: number, start = BACKOFF_START_MS, max = BACKOFF_MAX_MS): number {
  return Math.min(max, start * 2 ** Math.max(0, failures - 1))
}

/** Whether this zoom shows buildings and houses (so it needs the detail layer); at or below `FAR_ZOOM` the coarse layer serves it. */
export const wantsDetail = (zoom: number | undefined): boolean => zoom === undefined || zoom > FAR_ZOOM

type TileUnit = { kind: 'tile'; id: TileId; key: string }
type GraphUnit = { kind: 'graph'; cells: CellId[]; keys: string[] }

const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A cache read the client never answers is a miss after this long (the clients have their own, shorter, limit). */
const CACHE_GUARD_MS = 3_000
function guarded<T>(read: Promise<T | undefined>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), CACHE_GUARD_MS)
    read.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

const codeOf = (error: unknown): OverpassErrorCode | TileErrorCode => (error instanceof OverpassError || error instanceof TileError ? error.code : 'network')

/**
 * Loads what the camera shows (requirement 21). Painting comes only from vector tiles: the coarse
 * layer (z12, streets, green, water) for every cell in view, then the detail layer (z14, buildings,
 * paths, landmarks) for the cells in view at zooms above `FAR_ZOOM`, then the route ahead. A cell is
 * painted as soon as every tile it is assembled from is in (`tilesForCell`). Overpass is asked only
 * for graph cells along the route ahead, in a lane of its own that never delays a tile and never
 * counts for readiness.
 *
 * Every view change replans from the new view. Cached data is read at once (local only); nothing is
 * requested until the view has rested `SETTLE_MS`. A view that rests off the frame moves the frame
 * first (requirement 20.17). At most `MAX_TILE_CONCURRENT` tile downloads run; a failed tile waits a
 * jittered, doubling back-off, a 429 pauses the tile lane. Cells are added one per task with a yield,
 * so no frame carries more than one cell of work.
 */
export class Streamer {
  private readonly o: Required<Omit<StreamerOptions, 'onError' | 'onChange' | 'keep' | 'onLoad' | 'onFrame' | 'graph'>> & Pick<StreamerOptions, 'onError' | 'onChange' | 'keep' | 'onLoad' | 'onFrame' | 'graph'>
  /** Cells of the view inside the frame. */
  private viewCells: CellId[] = []
  /** Every cell the camera shows, in the frame or not: what readiness is measured against. */
  private shownCells: CellId[] = []
  private box: BBox | undefined
  private viewKey = ''
  private centre: LatLon | undefined
  private zoom: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerAt = Infinity
  private pumping = false
  private again = false
  private disposed = false
  private settledAt = 0
  private activeTiles = 0
  private activeGraph = 0
  private readonly inFlight = new Set<string>()
  private readonly missed = new Set<string>()
  private readonly sent: number[] = []
  private readonly failures = new Map<string, { n: number; until: number }>()
  private tilesPausedUntil = 0
  private readonly store = new Map<string, LoadedTile>()
  private load: MapLoad = IDLE_LOAD
  /** Tile downloads started so far (diagnostics and tests). */
  requests = 0
  /** Graph requests started so far. */
  graphRequests = 0

  constructor(options: StreamerOptions) {
    this.o = {
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      now: () => Date.now(),
      random: () => Math.random(),
      reanchor: () => false,
      ...options,
    }
  }

  /** The load state now. */
  status(): MapLoad {
    return this.load
  }

  /** The view moved. `zoom` is CSS px per tile. */
  setView(box: BBox, centre: LatLon, zoom?: number): void {
    if (this.disposed) return
    this.box = box
    this.centre = centre
    this.zoom = zoom
    const key = this.plan()
    this.showLoading()
    this.publish()
    if (key === this.viewKey) return
    this.viewKey = key
    this.settledAt = this.o.now() + SETTLE_MS
    this.scheduleIn(0, true)
  }

  /** Try again now (the device came back online); back-off still applies. */
  retry(): void {
    if (this.disposed || !this.shownCells.length) return
    this.missed.clear()
    this.showLoading()
    this.scheduleIn(0, true)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.store.clear()
  }

  /** Derive the wanted cells from the stored view (the frame may have moved). Returns the view key. */
  private plan(): string {
    const { world } = this.o
    const box = this.box
    const centre = this.centre
    if (!box || !centre) return ''
    const all = cellsInBBox(box)
    this.shownCells = all.length > MAX_VIEW_CELLS ? nearestFirst(all, centre).slice(0, MAX_VIEW_CELLS) : nearestFirst(all, centre)
    this.viewCells = this.shownCells.filter((c) => world.inFrame(c))
    return [this.shownCells.map(cellKey).sort().join(';'), this.viewCells.length, wantsDetail(this.zoom)].join('|')
  }

  private detailWanted(): boolean {
    return wantsDetail(this.zoom)
  }

  /** A cell in view lacks what this zoom needs. */
  private lacking(c: CellId): boolean {
    const { world } = this.o
    return !world.hasAny(c) || (this.detailWanted() && world.needs(c))
  }

  private showLoading(): void {
    const { world } = this.o
    world.setLoading(this.viewCells.filter((c) => !world.hasAny(c)))
  }

  private publish(): void {
    const view = this.shownCells
    if (!view.length) return this.setLoad(IDLE_LOAD)
    const lacking = view.filter((c) => this.lacking(c))
    if (!lacking.length) return this.setLoad({ ready: 'full', pending: 0 })
    this.setLoad({ ready: view.every((c) => this.o.world.hasAny(c)) ? 'coarse' : 'loading', pending: lacking.length })
  }

  private setLoad(next: MapLoad): void {
    if (next.ready === this.load.ready && next.pending === this.load.pending) return
    this.load = next
    this.o.onLoad?.(next)
  }

  /** Run `pump` in `ms`. A later call keeps the earlier time unless `replace` is set. */
  private scheduleIn(ms: number, replace = false): void {
    const at = this.o.now() + Math.max(0, ms)
    if (this.timer !== undefined && !replace && this.timerAt <= at) return
    clearTimeout(this.timer)
    this.timerAt = at
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.timerAt = Infinity
      void this.pump()
    }, Math.max(0, ms))
  }

  private cooling(key: string, now: number): boolean {
    return (this.failures.get(key)?.until ?? 0) > now
  }

  private jitter(ms: number): number {
    return Math.round(ms * (0.75 + 0.5 * this.o.random()))
  }

  private async pump(): Promise<void> {
    if (this.disposed) return
    if (this.pumping) {
      this.again = true
      return
    }
    this.pumping = true
    try {
      if (this.o.now() >= this.settledAt && this.offFrame()) await this.moveFrame()
      await this.cachePass()
      await this.assemble()
      if (!this.disposed) this.launch()
    } finally {
      this.pumping = false
    }
    if (this.again && !this.disposed) {
      this.again = false
      this.scheduleIn(0)
    }
  }

  /** The view shows cells outside the frame and the frame may follow it (requirement 20.17). */
  private offFrame(): boolean {
    const { world } = this.o
    if (!this.centre || !this.o.reanchor() || !this.shownCells.some((c) => !world.inFrame(c))) return false
    // A view larger than the frame keeps some cells outside it; moving onto the same cell would not help.
    const at = cellOf(this.centre)
    return at.i !== world.anchor.i || at.j !== world.anchor.j
  }

  /** Move the frame to the view centre, repaint what it holds nearest first (one cell per task), plan again. */
  private async moveFrame(): Promise<void> {
    const { world } = this.o
    const centre = this.centre!
    world.recentre(cellOf(centre))
    this.viewKey = this.plan()
    this.o.onFrame?.()
    this.o.onChange?.([])
    this.showLoading()
    this.publish()
    for (;;) {
      if (this.disposed) return
      const cell = world.paintNext(this.centre ?? centre)
      if (!cell) break
      this.o.onChange?.([cell])
      this.publish()
      await yieldToMain()
    }
  }

  /** The route ahead of the view centre, nearest along the route first (requirement 21.9). */
  private routeAhead(): CellId[] {
    const route = this.o.keep?.() ?? []
    const centre = this.centre
    if (!route.length || !centre) return []
    let at = 0
    let best = Infinity
    route.forEach((p, k) => {
      const d = haversine(p, centre)
      if (d < best) {
        best = d
        at = k
      }
    })
    if (best > 800) return []
    const out = new Map<string, CellId>()
    let along = 0
    for (let k = at; k < route.length && along <= AHEAD_M && out.size < AHEAD_MAX_CELLS; k++) {
      if (k > at) along += haversine(route[k - 1]!, route[k]!)
      const c = cellOf(route[k]!)
      if (this.o.world.inFrame(c)) out.set(cellKey(c), c)
    }
    return [...out.values()]
  }

  /** Cells to assemble, each with its layer, in priority order: coarse for the view, detail for the view, detail ahead. */
  private wanted(): { cell: CellId; detail: boolean }[] {
    const { world } = this.o
    const out: { cell: CellId; detail: boolean }[] = []
    for (const c of this.viewCells) if (world.needsCoarse(c)) out.push({ cell: c, detail: false })
    if (this.detailWanted()) {
      for (const c of this.viewCells) if (world.needs(c)) out.push({ cell: c, detail: true })
      const inView = new Set(this.viewCells.map(cellKey))
      for (const c of this.routeAhead()) if (!inView.has(cellKey(c)) && world.needs(c)) out.push({ cell: c, detail: true })
    }
    return out
  }

  /** The tiles the wanted cells still miss, in their order. */
  private missingTiles(): TileUnit[] {
    const seen = new Set<string>()
    const out: TileUnit[] = []
    for (const w of this.wanted()) {
      for (const id of tilesForCell(w.cell, w.detail ? DETAIL_Z : COARSE_Z)) {
        const key = `t:${tileKey(id)}`
        if (seen.has(key) || this.store.has(key)) continue
        seen.add(key)
        out.push({ kind: 'tile', id, key })
      }
    }
    return out
  }

  private keepTile(key: string, id: TileId, data: OsmData): void {
    this.store.delete(key)
    this.store.set(key, { id, data })
    const needed = new Set<string>()
    for (const w of this.wanted()) for (const id2 of tilesForCell(w.cell, w.detail ? DETAIL_Z : COARSE_Z)) needed.add(`t:${tileKey(id2)}`)
    const cap = Math.max(MAX_RESIDENT_TILES, needed.size)
    for (const k of this.store.keys()) {
      if (this.store.size <= cap) break
      if (!needed.has(k)) this.store.delete(k)
    }
  }

  /** Read cached tiles (and graph cells along the route) for what is wanted: local only, never a request. */
  private async cachePass(): Promise<void> {
    const { world, tiles, graph } = this.o
    world.touch(this.viewCells, this.o.now())
    for (const u of this.missingTiles()) {
      if (this.disposed) return
      if (this.missed.has(u.key) || this.inFlight.has(u.key)) continue
      const hit = await guarded(tiles.cachedTile(u.id))
      if (hit) this.keepTile(u.key, u.id, hit)
      else this.missed.add(u.key)
    }
    if (graph) {
      for (const c of this.routeAhead()) {
        const key = `g:${cellKey(c)}`
        if (this.disposed) return
        if (this.missed.has(key) || !world.needsGraph(c)) continue
        const hit = await guarded(graph.cachedCell(c))
        if (hit) this.addGraph([hit])
        else this.missed.add(key)
      }
    }
  }

  /** Build and add every wanted cell whose tiles are all in, one per task. */
  private async assemble(): Promise<void> {
    const { world } = this.o
    for (const w of this.wanted()) {
      if (this.disposed) return
      const ids = tilesForCell(w.cell, w.detail ? DETAIL_Z : COARSE_Z)
      const loaded = ids.map((id) => this.store.get(`t:${tileKey(id)}`))
      if (loaded.some((t) => !t)) continue
      // Still wanted? (an earlier step of this loop may have changed it)
      if (w.detail ? !world.needs(w.cell) : !world.needsCoarse(w.cell)) continue
      const rec = cellFromTiles(w.cell, loaded as LoadedTile[], w.detail)
      if (!rec) continue
      const done = w.detail ? world.addDrawn([rec]) : world.addCoarse([rec])
      if (done.length) this.added(done)
      this.showLoading()
      this.publish()
      await yieldToMain()
    }
    this.showLoading()
    this.publish()
  }

  private addGraph(records: readonly CellRecord[]): void {
    const done = this.o.world.add(records)
    if (done.length) this.added(done)
  }

  private added(cells: CellId[]): void {
    const centre = this.centre
    if (centre) this.o.world.evict(this.viewCells, this.o.keep?.() ?? [], centre)
    this.o.onChange?.(cells)
  }

  private sentInWindow(now: number): number {
    while (this.sent.length && this.sent[0]! <= now - MINUTE_MS) this.sent.shift()
    return this.sent.length
  }

  /** Start downloads until the slots, the caps or the back-offs say stop; set the next wake-up. */
  private launch(): void {
    this.showLoading()
    this.publish()
    if (!this.o.online()) return
    const now = this.o.now()
    if (now < this.settledAt) return this.scheduleIn(this.settledAt - now)
    if (this.offFrame()) return this.scheduleIn(0)
    let wake = Infinity
    // Tile lane.
    for (const u of this.missingTiles()) {
      if (this.activeTiles >= MAX_TILE_CONCURRENT || this.o.tiles.busy) break
      if (this.inFlight.has(u.key)) continue
      if (this.cooling(u.key, now)) {
        wake = Math.min(wake, this.failures.get(u.key)!.until - now)
        continue
      }
      if (this.tilesPausedUntil > now) {
        wake = Math.min(wake, this.tilesPausedUntil - now)
        break
      }
      if (this.sentInWindow(now) >= MAX_TILES_PER_MINUTE) {
        wake = Math.min(wake, this.sent[0]! + MINUTE_MS - now)
        break
      }
      this.sent.push(now)
      this.requests++
      this.start(u)
    }
    // Graph lane: one request at a time, only for the route ahead, never before a tile.
    const graph = this.o.graph
    if (graph && this.activeGraph === 0) {
      const wanted = this.routeAhead().filter((c) => this.o.world.needsGraph(c) && !this.inFlight.has(`g:${cellKey(c)}`) && !this.cooling(`g:${cellKey(c)}`, now))
      if (wanted.length) {
        const wait = graph.waitMs()
        if (wait > 0 || graph.busy) wake = Math.min(wake, Math.max(wait, 1000))
        else {
          const cells = planBatch(nearestFirst(wanted, this.centre!), GRAPH_BATCH)
          this.graphRequests++
          this.start({ kind: 'graph', cells, keys: cells.map((c) => `g:${cellKey(c)}`) })
        }
      }
    }
    if (wake < Infinity) this.scheduleIn(Math.max(200, wake))
  }

  private start(u: TileUnit | GraphUnit): void {
    const keys = u.kind === 'tile' ? [u.key] : u.keys
    for (const k of keys) this.inFlight.add(k)
    if (u.kind === 'tile') this.activeTiles++
    else this.activeGraph++
    void this.run(u, keys)
  }

  private async run(u: TileUnit | GraphUnit, keys: string[]): Promise<void> {
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      const stuck = new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new TileError('network', 'No answer')), UNIT_WATCHDOG_MS)
      })
      if (u.kind === 'tile') {
        const data = await Promise.race([this.o.tiles.loadTile(u.id), stuck])
        this.failures.delete(u.key)
        this.missed.delete(u.key)
        if (!this.disposed) this.keepTile(u.key, u.id, data)
      } else {
        const res = await Promise.race([this.o.graph!.loadCells(u.cells), stuck])
        for (const k of keys) this.failures.delete(k)
        if (!this.disposed) this.addGraph(res.records)
      }
    } catch (error) {
      this.failed(u, keys, error)
    } finally {
      clearTimeout(watchdog)
      for (const k of keys) this.inFlight.delete(k)
      if (u.kind === 'tile') this.activeTiles--
      else this.activeGraph--
    }
    if (this.disposed) return
    this.scheduleIn(0)
  }

  private failed(u: TileUnit | GraphUnit, keys: string[], error: unknown): void {
    const code = codeOf(error)
    const at = this.o.now()
    const graph = u.kind === 'graph'
    for (const k of keys) {
      const n = (this.failures.get(k)?.n ?? 0) + 1
      const base = graph ? backoffMs(n, GRAPH_BACKOFF_START_MS, GRAPH_BACKOFF_MAX_MS) : backoffMs(n)
      // `busy` is our own slot limit, not a failure of the server: try again soon.
      this.failures.set(k, { n: code === 'busy' ? 0 : n, until: at + (code === 'busy' ? 500 : this.jitter(base)) })
    }
    if (!graph && code === 'rateLimited') this.tilesPausedUntil = at + this.jitter(RATE_LIMIT_PAUSE_MS)
    this.o.onError?.(code)
  }
}
