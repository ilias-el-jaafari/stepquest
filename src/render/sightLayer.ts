import { SIGHT_LIT_SPRITES, SIGHT_SPRITES, sightAtlasLayout, type SightAtlasLayout } from '../sights/art.ts'
import { placeSights, type PlacedSight } from '../sights/place.ts'
import { SIGHT_KINDS, type SightMark } from '../sights/types.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { CHUNK } from './chunkLayer.ts'
import { chunkKey } from './chunkPlan.ts'
import type { Lighting } from './daylight.ts'
import { fitLabel } from './labelFit.ts'
import { makeCanvas } from './env.ts'
import { P } from './palette.ts'
import type { View } from './view.ts'

/**
 * Sights on the map (landmarks spec, L5). The marks are only those along the route. `drawStatic` blits the
 * day sprites into the cached scene before the sky tint, `drawNight` lights the windows and adds a faint glow
 * after it, `drawLabels` writes the names at quest zoom. Sprites come from one atlas painted on first use;
 * placement is computed when the marks, the keep-out set or the loaded map change, never per frame.
 */

/** Names show from this zoom (CSS px per tile). */
export const LABEL_ZOOM = 20

let atlas: HTMLCanvasElement | undefined
let layout: SightAtlasLayout | undefined
let glow: HTMLCanvasElement | undefined

function getAtlas(): { canvas: HTMLCanvasElement; layout: SightAtlasLayout } {
  layout ??= sightAtlasLayout()
  if (atlas) return { canvas: atlas, layout }
  const canvas = makeCanvas(layout.width, layout.height)
  const g = canvas.getContext('2d')
  if (g) {
    for (const k of SIGHT_KINDS) {
      for (const [frames, set] of [[layout.day, SIGHT_SPRITES], [layout.lit, SIGHT_LIT_SPRITES]] as const) {
        const slot = frames[k]
        set[k].rows.forEach((row, sy) => {
          for (let sx = 0; sx < row.length; sx++) {
            const colour = set[k].colors[row[sx] ?? '.']
            if (!colour) continue
            g.fillStyle = colour
            g.fillRect(slot.x + sx, slot.y + sy, 1, 1)
          }
        })
      }
    }
  }
  atlas = canvas
  return { canvas, layout }
}

/** Three stepped warm rings, 32 × 32, scaled up with nearest-neighbour. */
function getGlow(): HTMLCanvasElement {
  if (glow) return glow
  const c = makeCanvas(32, 32)
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#ffa23c'
    for (const [r, a] of [[16, 0.1], [11, 0.12], [6, 0.18]] as const) {
      g.globalAlpha = a
      g.beginPath()
      g.arc(16, 16, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  glow = c
  return c
}

const MAX_LABEL = 22
const labelOf = (m: SightMark): string | undefined => (m.name ? (m.name.length > MAX_LABEL ? `${m.name.slice(0, MAX_LABEL - 1)}…` : m.name) : undefined)

export class SightLayer {
  private marks: readonly SightMark[] = []
  private keep: ReadonlySet<number> = new Set()
  private placed: PlacedSight[] = []
  private stale = true
  private readonly grid: TileGrid
  /** Counts for tests and diagnostics: what the last draw put on the canvas. */
  readonly stats = { placed: 0, drawn: 0, labels: 0, lit: 0 }

  constructor(grid: TileGrid) {
    this.grid = grid
  }

  /** The marks along the route; returns true when they changed. */
  setMarks(marks: readonly SightMark[]): boolean {
    if (marks.length === this.marks.length && marks.every((m, i) => m.id === this.marks[i]!.id)) return false
    this.marks = marks
    this.stale = true
    return true
  }

  setKeepOut(keep: ReadonlySet<number>): void {
    this.keep = keep
    this.stale = true
  }

  /** The loaded map changed: look for spots again at the next paint. */
  invalidate(): void {
    if (this.marks.length) this.stale = true
  }

  get hasMarks(): boolean {
    return this.marks.length > 0
  }

  /** The sights standing on the map now (computed on demand). */
  get standing(): readonly PlacedSight[] {
    if (this.stale) {
      this.placed = placeSights(this.marks, this.grid, this.keep)
      this.stale = false
      this.stats.placed = this.placed.length
    }
    return this.placed
  }

  private visible(v: View): boolean {
    return v.detail && this.marks.length > 0
  }

  /** Foot position and size of a placed sight on the canvas. */
  private box(p: PlacedSight, v: View, kind = p.kind): { x: number; y: number; w: number; h: number } {
    const slot = getAtlas().layout.day[kind]
    const px = v.scale / 16
    const w = Math.round(slot.w * px)
    const h = Math.round(slot.h * px)
    const footX = v.originX + (p.x + p.w / 2) * v.scale
    const footY = v.originY + (p.y + p.h) * v.scale
    return { x: Math.round(footX - w / 2), y: Math.round(footY - h), w, h }
  }

  drawStatic(ctx: CanvasRenderingContext2D, v: View, painted: ReadonlySet<number>): void {
    this.stats.drawn = 0
    if (!this.visible(v)) return
    const { canvas, layout: l } = getAtlas()
    for (const p of this.standing) {
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const s = l.day[p.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
      this.stats.drawn++
    }
  }

  /** After the tint: warm windows over the dark sprites and a faint glow around them. */
  drawNight(ctx: CanvasRenderingContext2D, v: View, light: Lighting, painted: ReadonlySet<number>): void {
    this.stats.lit = 0
    if (!this.visible(v) || light.darkness < 0.15) return
    const { canvas, layout: l } = getAtlas()
    const g = getGlow()
    const strength = Math.min(1, light.darkness * 1.4)
    for (const p of this.standing) {
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const d = Math.round(Math.max(b.w, b.h) * 1.7)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.7 * strength
      ctx.drawImage(g, 0, 0, 32, 32, Math.round(b.x + b.w / 2 - d / 2), Math.round(b.y + b.h / 2 - d / 2), d, d)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = Math.min(1, strength)
      const s = l.lit[p.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
      this.stats.lit++
    }
    ctx.globalAlpha = 1
  }

  /** Names under the sprites at quest zoom: ink on a paper outline, so they read by day and night. */
  drawLabels(ctx: CanvasRenderingContext2D, v: View, painted: ReadonlySet<number>): void {
    this.stats.labels = 0
    if (!this.visible(v) || v.zoom < LABEL_ZOOM) return
    const font = Math.max(6 * v.dpr, Math.round(v.scale * 0.3))
    ctx.font = `${font}px "Press Start 2P", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, Math.round(font / 3))
    for (const p of this.standing) {
      const text = labelOf(p.mark)
      if (!text) continue
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      // Only names of sights that are on the screen; the name itself is slid inside the view (labelFit).
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const textW = ctx.measureText?.(text)?.width ?? text.length * font
      const at = fitLabel(b.x + b.w / 2, b.y, b.y + b.h, textW + ctx.lineWidth, font, v.w, v.h, Math.round(4 * v.dpr), Math.round(font * 0.3))
      const cx = at.x
      const y = at.y
      ctx.strokeStyle = P.white
      ctx.strokeText(text, cx, y)
      ctx.fillStyle = P.ink
      ctx.fillText(text, cx, y)
      this.stats.labels++
    }
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
  }
}
