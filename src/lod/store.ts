import { makeCanvas, nowMs, releaseCanvas } from '../render/env.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { LOD_SLICE_MS, LodPainter } from './paint.ts'
import { type LodLevel } from './select.ts'
import { type LodTile } from './tile.ts'

/** Bytes of painted bitmaps kept (requirement 25.4): 12 tiles at 1024 px, 48 at 512 px. */
export const LOD_BITMAP_BUDGET_BYTES = 48 * 1024 * 1024
/** LOD tiles kept in memory (street lines, names and footprints, about 100 KB each; the rest is read again from IndexedDB). */
export const MAX_RESIDENT_LOD = 220

export type TileState = 'unknown' | 'pending' | 'ready' | 'failed'

type Bitmap = { canvas: HTMLCanvasElement; level: LodLevel; painter: LodPainter | undefined; bytes: number; used: number }

export type StoreOptions = {
  now?: () => number
  canvas?: (size: number) => { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined
  /** Run `fn` as a later task (default `setTimeout(0)`). */
  later?: (fn: () => void) => void
  bitmapBudgetBytes?: number
  maxResident?: number
  sliceMs?: number
}

/** A finished bitmap redraws the scene; while many are queued (a pan over new ground) that happens at most this often. */
export const REDRAW_GAP_MS = 120
/** The painting slices wait for an idle moment of the page, but at most this long (requirement 25.5). */
export const IDLE_TIMEOUT_MS = 150
/** Where there is no idle callback (Safari), a slice waits this long, so painting takes about half of the time. */
const SLICE_PAUSE_MS = 8

/** Run `fn` when the page has nothing better to do: new tiles are painted between frames, not in front of them. */
function whenIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric.call(globalThis, fn, { timeout: IDLE_TIMEOUT_MS })
  else setTimeout(fn, SLICE_PAUSE_MS)
}

const defaultCanvas = (size: number) => {
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d')
  return ctx ? { canvas, ctx } : undefined
}

/**
 * The LOD tiles of the map and their bitmaps (requirement 25.4 and 25.5). A tile arrives with `put`; the layer asks for the
 * bitmap of a tile at a level with `want` and draws what `bitmap` returns: the finished bitmap of that level, else a finished one
 * of another level (scaled), else nothing. Bitmaps are painted one slice per task (`LOD_SLICE_MS`), nearest request first, and kept
 * in a least-recently-used set bounded by bytes. A bitmap is never rebuilt while it is kept, so zooming inside a level costs nothing.
 */
export class LodStore {
  private readonly o: Required<StoreOptions>
  private readonly tiles = new Map<string, LodTile>()
  private readonly states = new Map<string, TileState>()
  private readonly bitmaps = new Map<string, Bitmap>()
  /** Finished bitmaps per tile key, so `has` costs one lookup. */
  private readonly finished = new Map<string, number>()
  private wanted = new Set<string>()
  private queue: string[] = []
  private scheduled = false
  private frame = 0
  private bitmapBytes = 0
  private lastRedraw = -Infinity
  private readonly listeners = new Set<() => void>()
  /** Bumped when a tile arrives (labels and snapping depend on it). */
  version = 0
  /** Bitmaps painted whole, slices run (tests, diagnostics). */
  stats = { bitmapsDone: 0, slices: 0, maxSliceMs: 0 }

  constructor(options: StoreOptions = {}) {
    this.o = { now: nowMs, canvas: defaultCanvas, later: whenIdle, bitmapBudgetBytes: LOD_BITMAP_BUDGET_BYTES, maxResident: MAX_RESIDENT_LOD, sliceMs: LOD_SLICE_MS, ...options }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Something the layer draws from changed that is not a tile (the focus points): listeners redraw. */
  changed(): void {
    this.emit()
  }

  state(id: TileId): TileState {
    return this.states.get(tileKey(id)) ?? 'unknown'
  }

  markPending(id: TileId): void {
    const k = tileKey(id)
    if (!this.states.has(k) || this.states.get(k) === 'failed') this.states.set(k, 'pending')
  }

  markFailed(id: TileId): void {
    const k = tileKey(id)
    if (this.states.get(k) === 'ready') return
    this.states.set(k, 'failed')
    this.version++
    this.emit()
  }

  /** The tile is in (from the network or the device cache). */
  put(tile: LodTile): void {
    const k = tileKey(tile.id)
    this.tiles.delete(k)
    this.tiles.set(k, tile)
    this.states.set(k, 'ready')
    // A new tile for a bitmap that was painted from an older one (never happens within a session, but costs nothing to be exact).
    const stale = [...this.bitmaps.keys()].filter((b) => b.startsWith(`${k}@`))
    for (const b of stale) this.drop(b)
    while (this.tiles.size > this.o.maxResident) {
      const oldest = this.tiles.keys().next().value as string
      this.tiles.delete(oldest)
      // Not resident any more: asking again reads the device cache.
      if (!this.hasBitmap(oldest)) this.states.delete(oldest)
    }
    this.version++
    this.emit()
  }

  tile(id: TileId): LodTile | undefined {
    return this.tiles.get(tileKey(id))
  }

  /** The tiles in memory, most recently added last. */
  resident(): readonly LodTile[] {
    return [...this.tiles.values()]
  }

  private hasBitmap(k: string): boolean {
    for (const b of this.bitmaps.keys()) if (b.startsWith(`${k}@`)) return true
    return false
  }

  /** Whether something of the tile can be drawn: the tile itself or a finished bitmap. */
  has(id: TileId): boolean {
    const k = tileKey(id)
    return this.tiles.has(k) || (this.finished.get(k) ?? 0) > 0
  }

  /** Start of a frame's requests: what was wanted before is forgotten (stale jobs are dropped by `endFrame`). */
  beginFrame(): void {
    this.frame++
    this.wanted = new Set()
  }

  /** Ask for the bitmap of `id` at `level`. */
  want(id: TileId, level: LodLevel): void {
    const k = tileKey(id)
    const key = `${k}@${level}`
    this.wanted.add(key)
    const b = this.bitmaps.get(key)
    if (b) {
      b.used = this.frame
      return
    }
    const tile = this.tiles.get(k)
    if (!tile) return
    const made = this.o.canvas(level)
    if (!made) return
    this.bitmaps.set(key, { canvas: made.canvas, level, painter: new LodPainter(tile, made.ctx, level, this.o.now), bytes: level * level * 4, used: this.frame })
    this.bitmapBytes += level * level * 4
    this.queue.push(key)
    this.evict()
    this.schedule()
  }

  /** End of a frame's requests: queued jobs nobody wants any more are dropped, unfinished canvases released. */
  endFrame(): void {
    const keep: string[] = []
    for (const key of this.queue) {
      if (this.wanted.has(key)) keep.push(key)
      else this.drop(key)
    }
    this.queue = keep
  }

  /** The best finished bitmap of `id` for `level`: that level, else the closest other one. */
  bitmap(id: TileId, level: LodLevel): { canvas: HTMLCanvasElement; level: LodLevel } | undefined {
    const k = tileKey(id)
    const exact = this.bitmaps.get(`${k}@${level}`)
    if (exact && !exact.painter) return { canvas: exact.canvas, level }
    let best: Bitmap | undefined
    for (const [key, b] of this.bitmaps) {
      if (!key.startsWith(`${k}@`) || b.painter) continue
      if (!best || Math.abs(Math.log(b.level / level)) < Math.abs(Math.log(best.level / level))) best = b
    }
    if (best) best.used = this.frame
    return best && { canvas: best.canvas, level: best.level }
  }

  private drop(key: string): void {
    const b = this.bitmaps.get(key)
    if (!b) return
    this.bitmaps.delete(key)
    if (!b.painter) {
      const tk = key.slice(0, key.indexOf('@'))
      const n = (this.finished.get(tk) ?? 1) - 1
      if (n > 0) this.finished.set(tk, n)
      else this.finished.delete(tk)
    }
    this.bitmapBytes -= b.bytes
    releaseCanvas(b.canvas)
  }

  /** Least recently used finished bitmaps go first; what this frame wants stays. */
  private evict(): void {
    if (this.bitmapBytes <= this.o.bitmapBudgetBytes) return
    const old = [...this.bitmaps.entries()].filter(([key, b]) => !b.painter && !this.wanted.has(key)).sort((a, b) => a[1].used - b[1].used)
    for (const [key] of old) {
      if (this.bitmapBytes <= this.o.bitmapBudgetBytes) break
      this.drop(key)
    }
  }

  get bytes(): number {
    return this.bitmapBytes
  }

  get bitmapCount(): number {
    return this.bitmaps.size
  }

  /** Painting jobs waiting or running. */
  get pending(): number {
    return this.queue.length
  }

  private schedule(): void {
    if (this.scheduled || !this.queue.length) return
    this.scheduled = true
    this.o.later(() => {
      this.scheduled = false
      this.slice()
    })
  }

  /** One task of painting: a slice of the first job. Public so tests can drive it. */
  slice(): void {
    const key = this.queue[0]
    if (key === undefined) return
    const b = this.bitmaps.get(key)
    if (!b?.painter) {
      this.queue.shift()
      return this.schedule()
    }
    const t0 = this.o.now()
    const done = b.painter.run(this.o.sliceMs)
    const took = this.o.now() - t0
    this.stats.slices++
    if (took > this.stats.maxSliceMs) this.stats.maxSliceMs = took
    if (done) {
      b.painter = undefined
      const tk = key.slice(0, key.indexOf('@'))
      this.finished.set(tk, (this.finished.get(tk) ?? 0) + 1)
      this.queue.shift()
      this.stats.bitmapsDone++
      this.evict()
      // The scene is drawn again for the last bitmap of a backlog and otherwise at most every `REDRAW_GAP_MS`, not once per bitmap.
      const now = this.o.now()
      if (!this.queue.length || now - this.lastRedraw >= REDRAW_GAP_MS) {
        this.lastRedraw = now
        this.emit()
      }
    }
    this.schedule()
  }

  dispose(): void {
    for (const key of [...this.bitmaps.keys()]) this.drop(key)
    this.tiles.clear()
    this.finished.clear()
    this.states.clear()
    this.queue = []
    this.listeners.clear()
  }
}
