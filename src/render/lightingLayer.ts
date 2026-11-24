import type { LatLon } from '../geo/geo.ts'
import { TILE_PX, type TileGrid } from '../tiles/grid.ts'
import { CHUNK, type ChunkLayer } from './chunkLayer.ts'
import { chunkKey, type ChunkPlan } from './chunkPlan.ts'
import { atLocalMinutes, cssRgb, lightingAt, type Lighting } from './daylight.ts'
import { makeCanvas } from './env.ts'
import { lampsInChunk } from './lamps.ts'
import { LAMP_RGB, litHouseWindows, litLandmarkWindows, paintGlow, WINDOW_RGB } from './lights.ts'
import type { View } from './view.ts'

/** The lighting is recomputed at most this often, and the sky repaints on this timer. */
const LIGHT_CACHE_MS = 30_000
const SKY_REPAINT_MS = 60_000

/**
 * The day-cycle layer: the clock (real time or the `?time=` preview), the sky tint, and the window
 * and street lamp light drawn over painted chunks. The chunk cache never contains light, so the
 * time of day changes nothing but this layer. Nothing here animates.
 */
export class LightingLayer {
  /** Lighting preview clock (minutes after local midnight); undefined follows the real time. */
  private clockOverride: number | undefined
  private cache: { key: number; value: Lighting } | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private visibility: (() => void) | undefined
  private readonly glows = new WeakMap<readonly number[], HTMLCanvasElement>()
  private stamp = 0
  private houseSeen: Int32Array
  private landmarkSeen: Int32Array

  private readonly grid: TileGrid
  private readonly chunks: ChunkLayer
  private readonly onTick: () => void

  constructor(grid: TileGrid, chunks: ChunkLayer, onTick: () => void) {
    this.grid = grid
    this.chunks = chunks
    this.onTick = onTick
    this.houseSeen = new Int32Array(chunks.town.houses.length)
    this.landmarkSeen = new Int32Array(chunks.town.landmarks.length)
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
    const town = this.chunks.town
    const isPainted = (x: number, y: number) => painted.has(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))
    if (light.windows > 0.02) {
      const stamp = ++this.stamp
      ctx.globalAlpha = light.windows
      ctx.fillStyle = WINDOW_RGB
      for (const c of plan.visible) {
        if (!painted.has(chunkKey(c.cx, c.cy))) continue
        const entry = this.chunks.structuresIn(c.cx, c.cy)
        if (!entry) continue
        for (const k of entry.houses) {
          if (this.houseSeen[k] === stamp) continue
          this.houseSeen[k] = stamp
          const h = town.houses[k]!
          const bx = originX + h.x * scale
          const by = originY + h.y * scale
          for (const r of litHouseWindows(h)) {
            if (isPainted(h.x + r.x / TILE_PX, h.y + r.y / TILE_PX)) ctx.fillRect(Math.round(bx + r.x * px), Math.round(by + r.y * px), Math.max(1, Math.round(r.w * px)), Math.max(1, Math.round(r.h * px)))
          }
        }
        for (const k of entry.landmarks) {
          if (this.landmarkSeen[k] === stamp) continue
          this.landmarkSeen[k] = stamp
          const l = town.landmarks[k]!
          const bx = originX + l.x * scale
          const by = originY + l.y * scale
          for (const r of litLandmarkWindows(l)) {
            if (isPainted(l.x + r.x / TILE_PX, l.y + r.y / TILE_PX)) ctx.fillRect(Math.round(bx + r.x * px), Math.round(by + r.y * px), Math.max(1, Math.round(r.w * px)), Math.max(1, Math.round(r.h * px)))
          }
        }
      }
      ctx.globalAlpha = 1
    }
    if (light.lamps > 0.02) {
      ctx.globalCompositeOperation = 'lighter'
      for (const c of plan.visible) {
        if (!painted.has(chunkKey(c.cx, c.cy))) continue
        for (const lamp of lampsInChunk(this.grid, c.cx, c.cy, CHUNK)) this.drawGlow(ctx, originX + (lamp.x + 0.5) * scale, originY + (lamp.y + 0.5) * scale, 5, scale, LAMP_RGB, light.lamps)
      }
      ctx.globalCompositeOperation = 'source-over'
      // Lamp heads: a bright 2×2 art-pixel dot in the middle of each pool.
      ctx.fillStyle = '#fff2b8'
      ctx.globalAlpha = light.lamps
      const dot = Math.max(1, Math.round(2 * px))
      for (const c of plan.visible) {
        if (!painted.has(chunkKey(c.cx, c.cy))) continue
        for (const lamp of lampsInChunk(this.grid, c.cx, c.cy, CHUNK)) ctx.fillRect(Math.round(originX + (lamp.x + 0.5) * scale - dot / 2), Math.round(originY + (lamp.y + 0.5) * scale - dot / 2), dot, dot)
      }
      ctx.globalAlpha = 1
    }
  }
}
