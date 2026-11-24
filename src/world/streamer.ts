import type { BBox, LatLon } from '../geo/geo.ts'
import type { OverpassClient, OverpassErrorCode } from '../osm/overpass.ts'
import { OverpassError } from '../osm/overpass.ts'
import { cellKey, cellsInBBox, MAX_BATCH_CELLS, nearestFirst, planBatch, type CellId } from './cells.ts'
import type { LiveWorld } from './liveWorld.ts'
import type { CellRecord } from './slice.ts'

/** The view must rest this long before cells are asked for (a pan that never rests sends nothing). */
export const SETTLE_MS = 1000
/** At most this many cells are downloaded in any 60 s window (3 requests of 4 cells). */
export const MAX_CELLS_PER_MINUTE = 12
export const MINUTE_MS = 60_000
/** After a failure a cell waits this long, doubling per failure up to BACKOFF_MAX_MS. */
export const BACKOFF_START_MS = 30_000
export const BACKOFF_MAX_MS = 5 * 60_000
/** A view this zoomed out asks for nothing beyond the frame anyway; this caps the list per view. */
const MAX_VIEW_CELLS = 81

export type CellClient = Pick<OverpassClient, 'loadCells' | 'cachedCell' | 'busy' | 'waitMs'>
export type StreamTarget = Pick<LiveWorld, 'needs' | 'add' | 'setLoading' | 'touch' | 'evict' | 'inFrame'>

export type StreamerOptions = {
  client: CellClient
  world: StreamTarget
  /** False while the device is offline: cached cells still load, nothing is requested. */
  online?: () => boolean
  now?: () => number
  /** Points of the active route: cells near them are never evicted. */
  keep?: () => readonly LatLon[]
  /** Cells were added to the world (the app takes a new snapshot). */
  onChange?: (cells: CellId[]) => void
  /** A download failed (the cells wait for their back-off). */
  onError?: (code: OverpassErrorCode) => void
}

/** Back-off after `failures` failures in a row. */
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, failures - 1))
}

/**
 * Loads the cells around the view (requirement 19.2 to 19.5). Every view change replans from the new
 * view (the old wish list is dropped); nothing happens until the view has rested `SETTLE_MS`, and a
 * view that keeps the same cells (follow mode while walking) does not restart the wait. Then: cached
 * cells first (local reads only), then one request for a rectangle of at most `MAX_BATCH_CELLS`
 * missing cells, nearest first, never while another download runs, never inside the client's spacing,
 * never above `MAX_CELLS_PER_MINUTE`, and never for a cell in its back-off. An answer that arrives
 * after the view moved on is still kept (it is already paid for and cached).
 */
export class Streamer {
  private readonly o: Required<Omit<StreamerOptions, 'onError' | 'onChange' | 'keep'>> & Pick<StreamerOptions, 'onError' | 'onChange' | 'keep'>
  private viewCells: CellId[] = []
  private viewKey = ''
  private centre: LatLon | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private again = false
  private disposed = false
  private readonly sent: number[] = []
  private readonly failures = new Map<string, { n: number; until: number }>()
  private pausedUntil = 0
  /** Requests sent so far (diagnostics and tests). */
  requests = 0

  constructor(options: StreamerOptions) {
    this.o = {
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      now: () => Date.now(),
      ...options,
    }
  }

  /** The view moved: plan from it once it rests. */
  setView(box: BBox, centre: LatLon): void {
    if (this.disposed) return
    const cells = cellsInBBox(box).filter((c) => this.o.world.inFrame(c))
    const view = cells.length > MAX_VIEW_CELLS ? nearestFirst(cells, centre).slice(0, MAX_VIEW_CELLS) : cells
    this.centre = centre
    const key = view.map(cellKey).sort().join(';')
    this.showLoading(view)
    if (key === this.viewKey) return
    this.viewKey = key
    this.viewCells = view
    this.schedule(SETTLE_MS)
  }

  /** Try again now (the device came back online); the usual spacing and back-off still apply. */
  retry(): void {
    if (this.disposed || !this.viewCells.length) return
    this.showLoading(this.viewCells)
    this.schedule(0)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private showLoading(view: readonly CellId[]): void {
    this.o.world.setLoading(this.o.online() ? view.filter((c) => this.o.world.needs(c)) : [])
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.pump()
    }, Math.max(0, ms))
  }

  private cooling(c: CellId, now: number): boolean {
    return (this.failures.get(cellKey(c))?.until ?? 0) > now
  }

  private sentInWindow(now: number): number {
    while (this.sent.length && this.sent[0]! <= now - MINUTE_MS) this.sent.shift()
    return this.sent.length
  }

  private async pump(): Promise<void> {
    if (this.disposed) return
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    let next: number | undefined
    try {
      next = await this.step()
    } finally {
      this.running = false
    }
    if (this.disposed) return
    if (this.again) {
      this.again = false
      next = 0
    }
    if (next !== undefined && this.timer === undefined) this.schedule(next)
  }

  /** One round. Returns when to run again (ms), or undefined when nothing is left to do. */
  private async step(): Promise<number | undefined> {
    const { world, client } = this.o
    const view = this.viewCells
    const centre = this.centre
    if (!view.length || !centre) return undefined
    world.touch(view, this.o.now())
    // Cache first: local reads only, never a request.
    const fromCache: CellRecord[] = []
    for (const c of nearestFirst(view.filter((c) => world.needs(c)), centre)) {
      const hit = await client.cachedCell(c)
      if (hit) fromCache.push(hit)
    }
    if (fromCache.length) this.added(world.add(fromCache))
    this.showLoading(view)
    if (!this.o.online()) return undefined
    const now = this.o.now()
    const wanted = nearestFirst(
      view.filter((c) => world.needs(c) && !this.cooling(c, now)),
      centre,
    )
    if (!wanted.length) {
      // Only cells in back-off are left: come back when the first one may be tried again.
      const waits = view.filter((c) => world.needs(c)).map((c) => (this.failures.get(cellKey(c))?.until ?? now) - now)
      return waits.length ? Math.max(1000, Math.min(...waits)) : undefined
    }
    const room = MAX_CELLS_PER_MINUTE - this.sentInWindow(now)
    const wait = Math.max(client.waitMs(), this.pausedUntil - now, room > 0 ? 0 : this.sent[0]! + MINUTE_MS - now)
    if (wait > 0) return wait
    if (client.busy) return 2000
    const batch = planBatch(wanted, Math.min(MAX_BATCH_CELLS, room))
    this.sent.push(...batch.map(() => now))
    this.requests++
    try {
      const res = await client.loadCells(batch)
      for (const c of batch) this.failures.delete(cellKey(c))
      this.added(world.add(res.records))
    } catch (error) {
      const code: OverpassErrorCode = error instanceof OverpassError ? error.code : 'network'
      const at = this.o.now()
      for (const c of batch) {
        const n = (this.failures.get(cellKey(c))?.n ?? 0) + 1
        this.failures.set(cellKey(c), { n, until: at + backoffMs(n) })
      }
      // The server says slow down: every request waits, not only these cells.
      if (code === 'rateLimited') this.pausedUntil = at + backoffMs(this.failures.get(cellKey(batch[0]!))!.n)
      this.o.onError?.(code)
    }
    this.showLoading(this.viewCells)
    return 0
  }

  private added(cells: CellId[]): void {
    if (!cells.length) return
    const centre = this.centre
    if (centre) this.o.world.evict(this.viewCells, this.o.keep?.() ?? [], centre)
    this.o.onChange?.(cells)
  }
}
