import type { LatLon } from '../geo/geo.ts'
import { TILE_PX, type TileGrid } from '../tiles/grid.ts'
import { CHUNK, type ChunkLayer } from './chunkLayer.ts'
import { chunkKey, type ChunkPlan } from './chunkPlan.ts'
import { atLocalMinutes, cssRgb, lightingAt, type Lighting } from './daylight.ts'
import { makeCanvas, nowMs, prefersReducedMotion } from './env.ts'
import { firefliesInChunk, fireflyLevel } from './fireflies.ts'
import { evenSubset, FLICKER_MS, flicker, type Lamp, lampsInChunk, MAX_LAMPS_PER_CHUNK, MAX_LAMPS_PER_FRAME } from './lamps.ts'
import { LAMP_RGB, litHouseWindows, litLandmarkWindows, paintGlow, WINDOW_RGB } from './lights.ts'
import type { View } from './view.ts'

/** The lighting is recomputed at most this often, and the sky repaints on this timer. */
const LIGHT_CACHE_MS = 30_000
const SKY_REPAINT_MS = 60_000

const POST_W = 6
const POST_H = 10
/** Lamp post: c cap, b bulb, p post. */
const POST_ART = ['.cccc.', 'cbbbbc', '.bbbb.', '..pp..', '..pp..', '..pp..', '..pp..', '..pp..', '..pp..', '.pppp.']
const FIREFLY_COLOR = '#d8ff7a'
const DOT_COLOR = '#ffd98a'

/**
 * The day-cycle layer: the clock (real time or the `?time=` preview), the sky tint, and the window
 * and street lamp light drawn over painted chunks. The chunk cache never contains light, so the
 * time of day changes nothing but this layer. Lamp pools flicker slightly and fireflies blink
 * (one timer, none with reduced motion).
 */
export class LightingLayer {
  /** Lighting preview clock (minutes after local midnight); undefined follows the real time. */
  private clockOverride: number | undefined
  private cache: { key: number; value: Lighting } | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private visibility: (() => void) | undefined
  private readonly glows = new WeakMap<readonly number[], HTMLCanvasElement>()
  private stamp = 0
  private post: HTMLCanvasElement | undefined
  private flickerTimer: ReturnType<typeof setTimeout> | undefined
  /** Frame stamp per structure, so one that spans several chunks is lit once. */
  private readonly seen = new WeakMap<object, number>()

  private readonly grid: TileGrid
  private readonly chunks: ChunkLayer
  private readonly onTick: () => void

  constructor(grid: TileGrid, chunks: ChunkLayer, onTick: () => void) {
    this.grid = grid
    this.chunks = chunks
    this.onTick = onTick
  }

  /** Preview a time of day for the lighting only (minutes after local midnight), or undefined for real time. */
  setClockOverride(minutes: number | undefined): void {
    this.clockOverride = minutes
    this.cache = undefined
  }

  /** Current lighting from the real (or overridden) clock and the map's location. */
  get lighting(): Lighting {
    const now = Date.now()
    const ms = this.clockOverride === undefined ? now : atLocalMinutes(now, this.clockOverride)
    const key = Math.floor(ms / LIGHT_CACHE_MS)
    if (this.cache?.key !== key) {
      const b = this.grid.bbox
      const place: LatLon = { lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 }
      this.cache = { key, value: lightingAt(ms, place) }
    }
    return this.cache.value
  }

  /** Repaint once a minute and when the page comes back to the front (idempotent). */
  start(): void {
    // The sky moves slowly: a repaint once a minute is enough to follow it (no per-frame animation).
    if (this.timer === undefined && typeof setInterval === 'function') this.timer = setInterval(this.onTick, SKY_REPAINT_MS)
    if (this.visibility === undefined && typeof document !== 'undefined') {
      this.visibility = () => {
        if (document.visibilityState !== 'hidden') this.onTick()
      }
      document.addEventListener('visibilitychange', this.visibility)
    }
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    if (this.visibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility)
    this.visibility = undefined
    if (this.flickerTimer !== undefined) clearTimeout(this.flickerTimer)
    this.flickerTimer = undefined
  }

  /** Multiply the whole canvas by the sky tint (skipped in full daylight). */
  drawTint(ctx: CanvasRenderingContext2D, view: View, light: Lighting): void {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = cssRgb(light.tint)
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.globalCompositeOperation = 'source-over'
  }

  private glow(rgb: readonly [number, number, number]): HTMLCanvasElement {
    let c = this.glows.get(rgb)
    if (!c) {
      c = makeCanvas(32, 32)
      paintGlow(c.getContext('2d')!, 32, rgb)
      this.glows.set(rgb, c)
    }
    return c
  }

  /** Additive glow centred on a screen point; `tiles` is its diameter in tiles. */
  drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, tiles: number, scale: number, rgb: readonly [number, number, number], alpha: number): void {
    const d = Math.round(tiles * scale)
    if (d < 2 || alpha <= 0) return
    ctx.globalAlpha = alpha
    ctx.drawImage(this.glow(rgb), Math.round(x - d / 2), Math.round(y - d / 2), d, d)
    ctx.globalAlpha = 1
  }

  /**
   * Warm window light and street lamp pools over the tinted map (detail zoom only). Only chunks that
   * are really painted get light: a stand-in is the blurry town map and must not grow windows.
   */
  drawNightLights(ctx: CanvasRenderingContext2D, view: View, plan: ChunkPlan, painted: ReadonlySet<number>, light: Lighting): void {
    const { originX, originY, scale } = view
    const px = scale / TILE_PX // device px per art pixel
    this.scheduleFlicker(false, false)
    const isPainted = (x: number, y: number) => painted.has(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))
    if (light.windows > 0.02) {
      const stamp = ++this.stamp
      ctx.globalAlpha = light.windows
      ctx.fillStyle = WINDOW_RGB
      for (const c of plan.visible) {
        if (!painted.has(chunkKey(c.cx, c.cy))) continue
        const entry = this.chunks.structuresIn(c.cx, c.cy)
        if (!entry) continue
        for (const h of entry.houses) {
          if (this.seen.get(h) === stamp) continue
          this.seen.set(h, stamp)
          const bx = originX + h.x * scale
          const by = originY + h.y * scale
          for (const r of litHouseWindows(h)) {
            if (isPainted(h.x + r.x / TILE_PX, h.y + r.y / TILE_PX)) ctx.fillRect(Math.round(bx + r.x * px), Math.round(by + r.y * px), Math.max(1, Math.round(r.w * px)), Math.max(1, Math.round(r.h * px)))
          }
        }
        for (const l of entry.landmarks) {
          if (this.seen.get(l) === stamp) continue
          this.seen.set(l, stamp)
          const bx = originX + l.x * scale
          const by = originY + l.y * scale
          for (const r of litLandmarkWindows(l)) {
            if (isPainted(l.x + r.x / TILE_PX, l.y + r.y / TILE_PX)) ctx.fillRect(Math.round(bx + r.x * px), Math.round(by + r.y * px), Math.max(1, Math.round(r.w * px)), Math.max(1, Math.round(r.h * px)))
          }
        }
      }
      ctx.globalAlpha = 1
    }
    if (light.lamps > 0.02) this.drawLampsDetail(ctx, view, plan, painted, light)
  }

  /** The lamps to draw in a chunk: capped per chunk, and the running frame total is kept in `budget`. */
  private chunkLamps(cx: number, cy: number, budget: { left: number }): readonly Lamp[] {
    const list = evenSubset(lampsInChunk(this.grid, cx, cy, CHUNK), Math.min(MAX_LAMPS_PER_CHUNK, budget.left))
    budget.left -= list.length
    return list
  }

  /** Lamp pools, fireflies and lamp posts at detail zoom (requirements 22.1, 22.5, 22.6). */
  private drawLampsDetail(ctx: CanvasRenderingContext2D, view: View, plan: ChunkPlan, painted: ReadonlySet<number>, light: Lighting): void {
    const { originX, originY, scale } = view
    const px = scale / TILE_PX
    const reduced = prefersReducedMotion()
    const now = nowMs()
    const budget = { left: MAX_LAMPS_PER_FRAME }
    const shown: Lamp[] = []
    ctx.globalCompositeOperation = 'lighter'
    for (const c of plan.visible) {
      if (!painted.has(chunkKey(c.cx, c.cy))) continue
      for (const lamp of this.chunkLamps(c.cx, c.cy, budget)) {
        shown.push(lamp)
        this.drawGlow(ctx, originX + (lamp.x + 0.5) * scale, originY + (lamp.y + 0.5) * scale, 5, scale, LAMP_RGB, light.lamps * flicker(lamp, now, reduced))
      }
    }
    // Fireflies: 1 to 2 art pixels, additive, dimmer than a gem's glow.
    let flies = 0
    const size = Math.max(1, Math.round(1.5 * px))
    ctx.fillStyle = FIREFLY_COLOR
    for (const c of plan.visible) {
      if (!painted.has(chunkKey(c.cx, c.cy))) continue
      for (const f of firefliesInChunk(this.grid, c.cx, c.cy, CHUNK)) {
        const level = fireflyLevel(f, now, reduced) * light.lamps * 0.85
        flies++
        if (level < 0.05) continue
        ctx.globalAlpha = level
        ctx.fillRect(Math.round(originX + f.x * scale), Math.round(originY + f.y * scale), size, size)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    // Lamp posts over the pools.
    const post = this.lampPost()
    const w = Math.max(3, Math.round(POST_W * px))
    const h = Math.max(5, Math.round(POST_H * px))
    ctx.globalAlpha = Math.min(1, light.lamps * 1.2)
    for (const lamp of shown) {
      const x = Math.round(originX + lamp.x * scale + (TILE_PX / 2 - POST_W / 2) * px)
      const y = Math.round(originY + lamp.y * scale + (13 - POST_H) * px)
      ctx.drawImage(post, x, y, w, h)
    }
    ctx.globalAlpha = 1
    this.scheduleFlicker(!reduced && (shown.length > 0 || flies > 0), flies > 0)
  }

  /** Overview and mid zoom: each lamp is a small light dot, no sprite (requirement 22.3). Static, no timer. */
  drawNightDots(ctx: CanvasRenderingContext2D, view: View, light: Lighting): void {
    this.scheduleFlicker(false, false)
    if (light.lamps <= 0.02) return
    const { originX, originY, scale, w, h } = view
    const cols = Math.ceil(this.grid.cols / CHUNK)
    const rows = Math.ceil(this.grid.rows / CHUNK)
    const c0 = Math.max(0, Math.floor(-originX / scale / CHUNK))
    const c1 = Math.min(cols - 1, Math.floor((w - originX) / scale / CHUNK))
    const r0 = Math.max(0, Math.floor(-originY / scale / CHUNK))
    const r1 = Math.min(rows - 1, Math.floor((h - originY) / scale / CHUNK))
    const dot = Math.max(1, Math.min(3, Math.round(scale * 2)))
    const budget = { left: MAX_LAMPS_PER_FRAME }
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = DOT_COLOR
    ctx.globalAlpha = light.lamps * 0.8
    for (let cy = r0; cy <= r1 && budget.left > 0; cy++) {
      for (let cx = c0; cx <= c1 && budget.left > 0; cx++) {
        for (const lamp of this.chunkLamps(cx, cy, budget)) {
          ctx.fillRect(Math.round(originX + (lamp.x + 0.5) * scale - dot / 2), Math.round(originY + (lamp.y + 0.5) * scale - dot / 2), dot, dot)
        }
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** The lamp post sprite, painted once (original art, 6×10 art pixels). */
  private lampPost(): HTMLCanvasElement {
    if (this.post) return this.post
    const c = makeCanvas(POST_W, POST_H)
    const g = c.getContext('2d')!
    const colours: Record<string, string> = { c: '#4a4656', b: '#fff2b8', p: '#2b2833' }
    POST_ART.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = colours[row[x]!]
        if (!col) continue
        g.fillStyle = col
        g.fillRect(x, y, 1, 1)
      }
    })
    this.post = c
    return c
  }

  /** Daylight: no light is drawn, so no flicker timer may run. */
  idle(): void {
    this.scheduleFlicker(false, false)
  }

  /** One timer at most: the next frame for flicker and firefly blinks, never with reduced motion. */
  private scheduleFlicker(on: boolean, flies: boolean): void {
    if (this.flickerTimer !== undefined) clearTimeout(this.flickerTimer)
    this.flickerTimer = undefined
    if (!on || typeof setTimeout === 'undefined') return
    const step = flies ? FLICKER_MS / 2 : FLICKER_MS
    this.flickerTimer = setTimeout(() => {
      this.flickerTimer = undefined
      this.onTick()
    }, step - (nowMs() % step))
  }
}
