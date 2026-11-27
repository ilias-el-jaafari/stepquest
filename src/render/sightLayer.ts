import { SIGHT_CROWN_LIT, SIGHT_CROWNS, SIGHT_LIT_SPRITES, SIGHT_SPRITES, sightAtlasLayout, type SightAtlasLayout } from '../sights/art.ts'
import { buildCampus, isBuildingRole, Role, roleAt, type Campus } from '../sights/campus.ts'
import { placeSights, type PlacedSight } from '../sights/place.ts'
import { SIGHT_KINDS, type SightMark } from '../sights/types.ts'
import { TILE_PX, type TileGrid } from '../tiles/grid.ts'
import type { House } from '../town/types.ts'
import { campusTile, haloSprite, MASK } from './campusArt.ts'
import { CHUNK } from './chunkLayer.ts'
import { chunkKey } from './chunkPlan.ts'
import type { Lighting } from './daylight.ts'
import { makeCanvas, releaseCanvas } from './env.ts'
import { tileEdgeX, tileEdgeY, type View } from './view.ts'

/**
 * Sights on the map (landmarks spec, L5, L10, L11). The marks are only those along the route. A mark with an
 * area (campus grounds or a building footprint) is drawn at its real size: special roof and façade tiles,
 * lawn, paving and trees in 32 × 32 chunk bitmaps (day layer and lit layer), a crown (the kind's landmark
 * part) on its main building. A mark without one keeps its fixed sprite on a paving plate. `drawStatic`
 * blits into the cached scene before the sky tint, `drawNight` lights the windows and adds a faint halo after
 * it. There are no name labels. Everything is built when the marks, the keep-out set or the loaded map change.
 */

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
      for (const [frames, set] of [[layout.day, SIGHT_SPRITES], [layout.lit, SIGHT_LIT_SPRITES], [layout.crown, SIGHT_CROWNS], [layout.crownLit, SIGHT_CROWN_LIT]] as const) {
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

/** Chunk bitmaps kept at once (512 × 512 each, day and lit). */
export const CAMPUS_CHUNKS = 24

type ChunkBitmaps = { day?: HTMLCanvasElement; lit?: HTMLCanvasElement }
type TownAt = { houseAt(i: number): House | undefined }
const NO_TOWN: TownAt = { houseAt: () => undefined }

export class SightLayer {
  private marks: readonly SightMark[] = []
  private sig = ''
  private keep: ReadonlySet<number> = new Set()
  private placed: PlacedSight[] = []
  private campuses: Campus[] = []
  private chunkList: { cx: number; cy: number }[] = []
  private blocked: ReadonlySet<number> = new Set()
  private bitmaps = new Map<number, ChunkBitmaps>()
  private stale = true
  private readonly grid: TileGrid
  private readonly town: TownAt
  /** Counts for tests and diagnostics: what the last draw put on the canvas. */
  readonly stats = { placed: 0, drawn: 0, lit: 0, campuses: 0, chunks: 0 }

  constructor(grid: TileGrid, town: TownAt = NO_TOWN) {
    this.grid = grid
    this.town = town
  }

  private static signature(marks: readonly SightMark[]): string {
    return marks.map((m) => `${m.id}${m.area ? `/${m.area.mode}${m.area.rings.map((r) => r.length).join('.')}` : ''}`).join('|')
  }

  /** The marks along the route; returns true when they (or their areas) changed. */
  setMarks(marks: readonly SightMark[]): boolean {
    const sig = SightLayer.signature(marks)
    if (sig === this.sig) return false
    this.sig = sig
    this.marks = marks
    this.stale = true
    return true
  }

  setKeepOut(keep: ReadonlySet<number>): void {
    this.keep = keep
    this.stale = true
  }

  /** The loaded map changed: build again at the next paint. */
  invalidate(): void {
    if (this.marks.length) this.stale = true
  }

  get hasMarks(): boolean {
    return this.marks.length > 0
  }

  private clearBitmaps(): void {
    for (const b of this.bitmaps.values()) {
      if (b.day) releaseCanvas(b.day)
      if (b.lit) releaseCanvas(b.lit)
    }
    this.bitmaps.clear()
  }

  private rebuild(): void {
    this.stale = false
    this.clearBitmaps()
    const campuses: Campus[] = []
    const fallback: SightMark[] = []
    for (const m of this.marks) {
      const c = m.area ? buildCampus(this.grid, this.town.houseAt, m) : undefined
      if (c) campuses.push(c)
      if (!c || c.buildings.length === 0) fallback.push(m)
    }
    this.campuses = campuses
    this.placed = placeSights(fallback, this.grid, this.keep)
    const chunks = new Map<number, { cx: number; cy: number }>()
    const blocked = new Set<number>()
    for (const c of campuses) {
      for (let cy = Math.floor(c.y0 / CHUNK); cy <= Math.floor((c.y0 + c.h - 1) / CHUNK); cy++) for (let cx = Math.floor(c.x0 / CHUNK); cx <= Math.floor((c.x0 + c.w - 1) / CHUNK); cx++) chunks.set(chunkKey(cx, cy), { cx, cy })
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (isBuildingRole(c.roles[y * c.w + x]!)) blocked.add((c.y0 + y) * this.grid.cols + c.x0 + x)
    }
    this.chunkList = [...chunks.values()]
    this.blocked = blocked
    this.stats.placed = this.placed.length
    this.stats.campuses = campuses.length
  }

  /** The fixed sprites standing on the map now (marks without a drawn area). */
  get standing(): readonly PlacedSight[] {
    if (this.stale) this.rebuild()
    return this.placed
  }

  /** The campuses built for the marks (computed on demand). */
  get areas(): readonly Campus[] {
    if (this.stale) this.rebuild()
    return this.campuses
  }

  /** Tiles of special buildings: the decor stays off them. */
  blockedTiles(): ReadonlySet<number> {
    if (this.stale) this.rebuild()
    return this.blocked
  }

  private visible(v: View): boolean {
    return v.detail && this.marks.length > 0
  }

  /** Foot position and size of a placed sprite on the canvas. */
  private box(p: PlacedSight, v: View): { x: number; y: number; w: number; h: number } {
    const slot = getAtlas().layout.day[p.kind]
    const px = v.scale / 16
    const w = Math.round(slot.w * px)
    const h = Math.round(slot.h * px)
    const footX = v.originX + (p.x + p.w / 2) * v.scale
    const footY = v.originY + (p.y + p.h) * v.scale
    return { x: Math.round(footX - w / 2), y: Math.round(footY - h), w, h }
  }

  private crownBox(c: Campus, v: View): { x: number; y: number; w: number; h: number } | undefined {
    if (!c.crown) return undefined
    const slot = getAtlas().layout.crown[c.kind]
    const px = v.scale / 16
    const w = Math.round(slot.w * px)
    const h = Math.round(slot.h * px)
    return { x: Math.round(v.originX + c.crown.x * v.scale - w / 2), y: Math.round(v.originY + c.crown.y * v.scale - h), w, h }
  }

  /** The day and lit bitmaps of one chunk: every special tile of every campus that touches it. */
  private bitmapsFor(cx: number, cy: number): ChunkBitmaps {
    const key = chunkKey(cx, cy)
    const found = this.bitmaps.get(key)
    if (found) {
      // Most recently used last.
      this.bitmaps.delete(key)
      this.bitmaps.set(key, found)
      return found
    }
    const out: ChunkBitmaps = {}
    const side = CHUNK * TILE_PX
    const day = makeCanvas(side, side)
    const lit = makeCanvas(side, side)
    const gd = day.getContext('2d')
    const gl = lit.getContext('2d')
    if (gd && gl) {
      let any = false
      let anyLit = false
      const X = cx * CHUNK
      const Y = cy * CHUNK
      for (const c of this.campuses) {
        for (let gy = Math.max(Y, c.y0); gy < Math.min(Y + CHUNK, c.y0 + c.h); gy++) {
          for (let gx = Math.max(X, c.x0); gx < Math.min(X + CHUNK, c.x0 + c.w); gx++) {
            const role = roleAt(c, gx, gy)
            if (role === Role.none) continue
            let mask = 0
            if (isBuildingRole(role)) {
              if (isBuildingRole(roleAt(c, gx, gy - 1))) mask |= MASK.N
              if (isBuildingRole(roleAt(c, gx + 1, gy))) mask |= MASK.E
              if (isBuildingRole(roleAt(c, gx, gy + 1))) mask |= MASK.S
              if (isBuildingRole(roleAt(c, gx - 1, gy))) mask |= MASK.W
            }
            const t = campusTile(c.kind, role, mask, gx, gy)
            if (t) {
              gd.drawImage(t, (gx - X) * TILE_PX, (gy - Y) * TILE_PX)
              any = true
            }
            const l = campusTile(c.kind, role, mask, gx, gy, true)
            if (l) {
              gl.drawImage(l, (gx - X) * TILE_PX, (gy - Y) * TILE_PX)
              anyLit = true
            }
          }
        }
      }
      if (any) out.day = day
      else releaseCanvas(day)
      if (anyLit) out.lit = lit
      else releaseCanvas(lit)
    }
    this.bitmaps.set(key, out)
    while (this.bitmaps.size > CAMPUS_CHUNKS) {
      const oldest = this.bitmaps.keys().next().value as number
      const b = this.bitmaps.get(oldest)!
      if (b.day) releaseCanvas(b.day)
      if (b.lit) releaseCanvas(b.lit)
      this.bitmaps.delete(oldest)
    }
    return out
  }

  /** Draw a chunk bitmap at its place, on the same pixel edges as the terrain chunks. */
  private blitChunk(ctx: CanvasRenderingContext2D, v: View, cx: number, cy: number, which: 'day' | 'lit'): boolean {
    const x = tileEdgeX(v, cx * CHUNK)
    const y = tileEdgeY(v, cy * CHUNK)
    const w = tileEdgeX(v, (cx + 1) * CHUNK) - x
    const h = tileEdgeY(v, (cy + 1) * CHUNK) - y
    if (x > v.w || y > v.h || x + w < 0 || y + h < 0) return false
    const bm = this.bitmapsFor(cx, cy)[which]
    if (!bm) return false
    ctx.drawImage(bm, 0, 0, CHUNK * TILE_PX, CHUNK * TILE_PX, x, y, w, h)
    return true
  }

  drawStatic(ctx: CanvasRenderingContext2D, v: View, painted: ReadonlySet<number>): void {
    this.stats.drawn = 0
    this.stats.chunks = 0
    if (!this.visible(v)) return
    if (this.stale) this.rebuild()
    const { canvas, layout: l } = getAtlas()
    for (const { cx, cy } of this.chunkList) {
      if (!painted.has(chunkKey(cx, cy))) continue
      if (this.blitChunk(ctx, v, cx, cy, 'day')) this.stats.chunks++
    }
    // Crowns, southern ones last so they stand in front.
    for (const c of [...this.campuses].sort((a, b) => (a.crown?.y ?? 0) - (b.crown?.y ?? 0))) {
      const b = this.crownBox(c, v)
      if (!b || b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      if (!painted.has(chunkKey(Math.floor(c.crown!.x / CHUNK), Math.floor((c.crown!.y - 1) / CHUNK)))) continue
      const s = l.crown[c.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
      this.stats.drawn++
    }
    for (const p of this.placed) {
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const s = l.day[p.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
      this.stats.drawn++
    }
  }

  /** After the tint: warm windows over the dark buildings and a faint halo around each. */
  drawNight(ctx: CanvasRenderingContext2D, v: View, light: Lighting, painted: ReadonlySet<number>): void {
    this.stats.lit = 0
    if (!this.visible(v) || light.darkness < 0.15) return
    if (this.stale) this.rebuild()
    const { canvas, layout: l } = getAtlas()
    const strength = Math.min(1, light.darkness * 1.4)
    const g = getGlow()
    const h = haloSprite()
    // Halos first (additive), then the windows on top.
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.7 * strength
    for (const c of this.campuses) {
      for (const b of c.buildings) {
        if (b.tiles < 3) continue
        const bw = (b.x1 - b.x0 + 1) * v.scale
        const bh = (b.y1 - b.y0 + 1) * v.scale
        const d = Math.round(Math.max(bw, bh) * 1.8 + v.scale * 2)
        const cxp = v.originX + ((b.x0 + b.x1 + 1) / 2) * v.scale
        const cyp = v.originY + ((b.y0 + b.y1 + 1) / 2) * v.scale
        if (cxp + d / 2 < 0 || cyp + d / 2 < 0 || cxp - d / 2 > v.w || cyp - d / 2 > v.h) continue
        if (!painted.has(chunkKey(Math.floor((b.x0 + b.x1) / 2 / CHUNK), Math.floor((b.y0 + b.y1) / 2 / CHUNK)))) continue
        ctx.drawImage(h, 0, 0, 32, 32, Math.round(cxp - d / 2), Math.round(cyp - d / 2), d, d)
        this.stats.lit++
      }
    }
    for (const p of this.placed) {
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const d = Math.round(Math.max(b.w, b.h) * 1.7)
      ctx.drawImage(g, 0, 0, 32, 32, Math.round(b.x + b.w / 2 - d / 2), Math.round(b.y + b.h / 2 - d / 2), d, d)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = Math.min(1, strength)
    for (const { cx, cy } of this.chunkList) {
      if (!painted.has(chunkKey(cx, cy))) continue
      if (this.blitChunk(ctx, v, cx, cy, 'lit')) this.stats.lit++
    }
    for (const c of this.campuses) {
      const b = this.crownBox(c, v)
      if (!b || b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const s = l.crownLit[c.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
    }
    for (const p of this.placed) {
      if (!painted.has(chunkKey(Math.floor((p.x + p.w / 2) / CHUNK), Math.floor((p.y + p.h - 1) / CHUNK)))) continue
      const b = this.box(p, v)
      if (b.x > v.w || b.y > v.h || b.x + b.w < 0 || b.y + b.h < 0) continue
      const s = l.lit[p.kind]
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, b.x, b.y, b.w, b.h)
      this.stats.lit++
    }
    ctx.globalAlpha = 1
  }

  /** Release the chunk bitmaps (the renderer is going away). */
  dispose(): void {
    this.clearBitmaps()
  }
}
