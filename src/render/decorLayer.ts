import { atlasLayout, DECOR_FRAMES, SPRITE_IDS, type AtlasSlot, type SpriteId } from '../decor/art.ts'
import { batFrame, batX, batY, flickerLevel, fogX, skeletonFrame, tickOf } from '../decor/anim.ts'
import { ANIM_FRAME_MS, decorBudget, MAX_ANIMATED } from '../decor/budget.ts'
import { decorInChunk, GRAVE_OFFSETS, hash3, type DecorItem } from '../decor/place.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { CHUNK } from './chunkLayer.ts'
import { chunkKey, type ChunkPlan } from './chunkPlan.ts'
import type { Lighting } from './daylight.ts'
import { makeCanvas, nowMs, prefersReducedMotion } from './env.ts'
import { evenSubset, lampsInChunk, MAX_LAMPS_PER_CHUNK } from './lamps.ts'
import type { View } from './view.ts'

/**
 * The Halloween decor (halloween-decor spec). Three jobs, all cheap:
 *
 * - `drawStatic` paints the still items into the cached scene, before the sky tint (so night tints them).
 * - `drawNight` adds the glows (pumpkins, candles, lanterns) and the witch hats on lamp posts after the tint.
 * - `drawAnimated` draws the few moving items (bats, fog, waving skeletons, flicker) in the overlay, at most
 *   `MAX_ANIMATED` per frame, with motion that steps at 12 Hz. Nothing here allocates per frame: sprites come
 *   from one atlas painted once, items from per-chunk lists built once, and the slot table is precomputed.
 */

const NO_KEEP: ReadonlySet<number> = new Set()

let atlas: HTMLCanvasElement | undefined
const SLOTS = {} as Record<SpriteId, AtlasSlot[]>
{
  const layout = atlasLayout()
  for (const id of SPRITE_IDS) SLOTS[id] = DECOR_FRAMES[id].map((_, i) => layout.slots[`${id}${i}`]!)
}

/** The decor atlas, painted on first use and kept for the page's life (about 128 × 100 px). */
function getAtlas(): HTMLCanvasElement {
  if (atlas) return atlas
  const layout = atlasLayout()
  const canvas = makeCanvas(layout.width, layout.height)
  const g = canvas.getContext('2d')
  if (g) {
    for (const id of SPRITE_IDS) {
      DECOR_FRAMES[id].forEach((sprite, i) => {
        const slot = layout.slots[`${id}${i}`]!
        sprite.rows.forEach((row, sy) => {
          for (let sx = 0; sx < row.length; sx++) {
            const colour = sprite.colors[row[sx] ?? '.']
            if (!colour) continue
            g.fillStyle = colour
            g.fillRect(slot.x + sx, slot.y + sy, 1, 1)
          }
        })
      })
    }
  }
  atlas = canvas
  return canvas
}

/** Glow diameter in tiles per kind. */
const GLOW_TILES = { jack: 2.2, candle: 1.4, lantern: 1.8 } as const

export class DecorLayer {
  private enabled: boolean
  private keep: ReadonlySet<number> = NO_KEEP
  private plan: ChunkPlan | undefined
  private painted: ReadonlySet<number> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Counts for tests and diagnostics: what the last draw of each pass put on the canvas. */
  readonly stats = { statics: 0, animated: 0, hats: 0 }

  private readonly grid: TileGrid
  private readonly onTick: () => void

  constructor(grid: TileGrid, onTick: () => void, enabled = true) {
    this.grid = grid
    this.onTick = onTick
    this.enabled = enabled
  }

  /** Switch the decor on or off. Returns true when that changed anything. */
  setEnabled(on: boolean): boolean {
    if (on === this.enabled) return false
    this.enabled = on
    if (!on) this.stopTimer()
    return true
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Tiles (row-major index) where nothing may stand: along the route, the start and the finish. */
  setKeepOut(tiles: ReadonlySet<number> | undefined): void {
    this.keep = tiles ?? NO_KEEP
  }

  dispose(): void {
    this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** The item is inside this frame's budget and not on a keep-out tile. */
  private shown(it: DecorItem, cap: number, density: number, night: boolean): boolean {
    if (it.order >= cap && !it.animated) return false
    if (it.rank >= density || (it.nightOnly && !night)) return false
    return !this.keep.has(it.ty * this.grid.cols + it.tx)
  }

  private blit(ctx: CanvasRenderingContext2D, id: SpriteId, frame: number, footX: number, footY: number, px: number, anchorLeft = false): void {
    const s = SLOTS[id][frame]!
    const dw = Math.max(1, Math.round(s.w * px))
    const dh = Math.max(1, Math.round(s.h * px))
    ctx.drawImage(getAtlas(), s.x, s.y, s.w, s.h, Math.round(anchorLeft ? footX : footX - dw / 2), Math.round(footY - dh), dw, dh)
  }

  /** Still items, into the scene (before the tint). `painted` holds the chunks that are really drawn (stand-ins get none). */
  drawStatic(ctx: CanvasRenderingContext2D, v: View, plan: ChunkPlan, painted: ReadonlySet<number>, light: Lighting): void {
    this.plan = plan
    this.painted = painted
    this.stats.statics = 0
    const b = decorBudget(v.zoom, light.darkness, this.enabled)
    if (!b.visible || !v.detail) return
    const { originX, originY, scale } = v
    const px = scale / 16
    for (const c of plan.visible) {
      if (!painted.has(chunkKey(c.cx, c.cy))) continue
      const { statics } = decorInChunk(this.grid, c.cx, c.cy, CHUNK)
      for (let k = 0; k < statics.length && k < b.staticPerChunk; k++) {
        const it = statics[k]!
        if (!this.shown(it, b.staticPerChunk, b.density, b.night)) continue
        const sx = originX + it.x * scale
        const sy = originY + it.y * scale
        this.stats.statics++
        switch (it.kind) {
          case 'pumpkin':
            this.blit(ctx, 'pumpkin', 0, sx, sy, px)
            break
          case 'jack':
            this.blit(ctx, b.night ? 'jackLit' : 'jack', 0, sx, sy, px)
            break
          case 'candle':
            this.blit(ctx, b.night ? 'candleLit' : 'candle', 0, sx, sy, px)
            break
          case 'lantern':
            this.blit(ctx, b.night ? 'lanternLit' : 'lantern', 0, sx, sy, px)
            break
          case 'crow':
            this.blit(ctx, 'crow', 0, sx, sy, px)
            break
          case 'graves':
            for (let g = 0; g < it.n; g++) {
              const o = GRAVE_OFFSETS[g]!
              this.blit(ctx, 'grave', (it.variant + g) % 3, sx + o[0] * scale, sy + o[1] * scale, px)
            }
            break
          case 'web': {
            // The corner of the web sits on the tile corner and reaches into the tile.
            const s = SLOTS.web[it.variant]!
            const dw = Math.max(1, Math.round(s.w * px))
            const dh = Math.max(1, Math.round(s.h * px))
            ctx.drawImage(getAtlas(), s.x, s.y, s.w, s.h, Math.round(it.variant & 1 ? sx - dw : sx), Math.round(it.variant & 2 ? sy - dh : sy), dw, dh)
            break
          }
          default:
            break
        }
      }
    }
  }

  /** Glows and lamp-post hats, after the tint, at night only. Uses the chunks of the last `drawStatic`. */
  drawNight(ctx: CanvasRenderingContext2D, v: View, light: Lighting): void {
    this.stats.hats = 0
    const plan = this.plan
    const painted = this.painted
    if (!plan || !painted || !v.detail) return
    const b = decorBudget(v.zoom, light.darkness, this.enabled)
    if (!b.visible || !b.night) return
    const { originX, originY, scale } = v
    const px = scale / 16
    const strength = Math.min(1, light.darkness * 1.4)
    const glow = SLOTS.glow[0]!
    const atlasCanvas = getAtlas()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.6 * strength
    for (const c of plan.visible) {
      if (!painted.has(chunkKey(c.cx, c.cy))) continue
      const { statics } = decorInChunk(this.grid, c.cx, c.cy, CHUNK)
      for (let k = 0; k < statics.length && k < b.staticPerChunk; k++) {
        const it = statics[k]!
        if (it.kind !== 'jack' && it.kind !== 'candle' && it.kind !== 'lantern') continue
        if (!this.shown(it, b.staticPerChunk, b.density, true)) continue
        const d = Math.round(GLOW_TILES[it.kind] * scale)
        if (d < 2) continue
        ctx.drawImage(atlasCanvas, glow.x, glow.y, glow.w, glow.h, Math.round(originX + it.x * scale - d / 2), Math.round(originY + (it.y - 0.2) * scale - d / 2), d, d)
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    // A witch hat on some of the lamp posts the lighting layer stands up at night.
    if (light.lamps > 0.02) {
      ctx.globalAlpha = Math.min(1, light.lamps * 1.2)
      for (const c of plan.visible) {
        if (!painted.has(chunkKey(c.cx, c.cy))) continue
        for (const lamp of evenSubset(lampsInChunk(this.grid, c.cx, c.cy, CHUNK), MAX_LAMPS_PER_CHUNK)) {
          if (!hatOn(lamp.x, lamp.y)) continue
          // The post's cap is 3 art pixels below the tile top; the hat sits on it.
          this.blit(ctx, 'hat', 0, originX + lamp.x * scale + 4 * px, originY + lamp.y * scale + 4 * px, px, true)
          this.stats.hats++
        }
      }
      ctx.globalAlpha = 1
    }
  }

  /**
   * Moving items, into the overlay canvas (screen view), under the route and the walker: bats and fog at night,
   * waving skeletons, a flicker on lit pumpkins, candles and lanterns. At most `MAX_ANIMATED` per frame;
   * `avoid` is the walker's tile, kept clear. With reduced motion everything rests at its anchor.
   */
  drawAnimated(ctx: CanvasRenderingContext2D, v: View, light: Lighting, now: number, avoid?: { x: number; y: number }): void {
    this.stats.animated = 0
    const plan = this.plan
    const painted = this.painted
    const b = decorBudget(v.zoom, light.darkness, this.enabled)
    if (!plan || !painted || !b.visible || !v.detail) {
      this.stopTimer()
      return
    }
    const reduced = prefersReducedMotion()
    const tick = tickOf(now, reduced)
    const { originX, originY, scale, w, h } = v
    const px = scale / 16
    const pad = 3 * scale
    const fade = Math.min(1, light.darkness * 1.4)
    const glow = SLOTS.glow[0]!
    const atlasCanvas = getAtlas()
    let drawn = 0
    for (const c of plan.visible) {
      if (drawn >= MAX_ANIMATED) break
      if (!painted.has(chunkKey(c.cx, c.cy))) continue
      const { statics, animated } = decorInChunk(this.grid, c.cx, c.cy, CHUNK)
      let perChunk = 0
      for (let k = 0; k < animated.length && perChunk < b.animPerChunk && drawn < MAX_ANIMATED; k++) {
        const it = animated[k]!
        if (!this.shown(it, b.staticPerChunk, b.density, b.night)) continue
        let x = it.x
        let y = it.y
        if (it.kind === 'bat') {
          x = batX(it, tick)
          y = batY(it, tick)
        } else if (it.kind === 'fog') x = fogX(it, tick)
        if (!onScreen(x, y, originX, originY, scale, w, h, pad) || near(avoid, x, y)) continue
        const sx = originX + x * scale
        const sy = originY + y * scale
        perChunk++
        drawn++
        if (it.kind === 'bat') {
          ctx.globalAlpha = fade
          this.blit(ctx, 'bat', batFrame(tick, it), sx, sy, px)
        } else if (it.kind === 'fog') {
          ctx.globalAlpha = 0.28 * fade
          this.blit(ctx, 'fog', 0, sx, sy, px)
        } else {
          ctx.globalAlpha = 1
          this.blit(ctx, 'skeleton', skeletonFrame(tick), sx, sy, px)
        }
      }
      ctx.globalAlpha = 1
      // Flicker on the glowing items that are on show at night.
      if (!b.night || reduced) continue
      ctx.globalCompositeOperation = 'lighter'
      for (let k = 0; k < statics.length && k < b.staticPerChunk && drawn < MAX_ANIMATED; k++) {
        const it = statics[k]!
        if (it.kind !== 'jack' && it.kind !== 'candle' && it.kind !== 'lantern') continue
        if (!this.shown(it, b.staticPerChunk, b.density, true)) continue
        if (!onScreen(it.x, it.y, originX, originY, scale, w, h, pad)) continue
        const d = Math.round(GLOW_TILES[it.kind] * 0.8 * scale)
        if (d < 2) continue
        drawn++
        ctx.globalAlpha = 0.35 * fade * flickerLevel(it, tick)
        ctx.drawImage(atlasCanvas, glow.x, glow.y, glow.w, glow.h, Math.round(originX + it.x * scale - d / 2), Math.round(originY + (it.y - 0.2) * scale - d / 2), d, d)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    this.stats.animated = drawn
    // One timer at 12 Hz while something moves; none with reduced motion or nothing to move.
    if (drawn > 0 && !reduced) this.schedule()
    else this.stopTimer()
  }

  private schedule(): void {
    if (this.timer !== undefined || typeof setTimeout === 'undefined') return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.onTick()
    }, ANIM_FRAME_MS - (nowMs() % ANIM_FRAME_MS))
  }
}

/** One lamp post in five wears a hat (stable). */
export function hatOn(x: number, y: number): boolean {
  return hash3(x, y, 11) % 5 === 0
}

function onScreen(x: number, y: number, ox: number, oy: number, scale: number, w: number, h: number, pad: number): boolean {
  const sx = ox + x * scale
  const sy = oy + y * scale
  return sx > -pad && sy > -pad && sx < w + pad && sy < h + pad
}

function near(avoid: { x: number; y: number } | undefined, x: number, y: number): boolean {
  return avoid !== undefined && Math.abs(avoid.x - x) < 1.5 && Math.abs(avoid.y - y) < 1.5
}
