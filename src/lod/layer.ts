import type { BBox, LatLon } from '../geo/geo.ts'
import { FAR_ZOOM } from '../render/camera.ts'
import { P } from '../render/palette.ts'
import type { View } from '../render/view.ts'
import { latOf, lonOf, tilesInBBox, type TileId } from '../vector/tileMath.ts'
import { cellBBox, type CellId } from '../world/cells.ts'
import { labelRank } from './classes.ts'
import { layoutLabels, MAX_LABELS, type LabelLine } from './labels.ts'
import { bitmapLevel, distanceToTileM, LABEL_MAX_ZOOM, labelMinZoom, LOD_Z } from './select.ts'
import { snapRadiusM, snapStreet, type Snap } from './snap.ts'
import type { LodStore } from './store.ts'
import { LOD_EXTENT } from './tile.ts'
import { DEFAULT_LOD_RADIUS_M, FOCUS_RADIUS_M } from './config.ts'

/** The map's own projection: the renderer's tile grid (tile units from lat/lon and back). */
export type Projector = {
  toTileXY(p: LatLon): { x: number; y: number }
  tileToLatLon(tx: number, ty: number): LatLon
  readonly metresPerTile: number
}

/** What a draw call did (tests, diagnostics). */
export type BlocksDraw = { bitmaps: number; standIns: number; placeholders: number; skipped: number; tiles: number }

/** CSS px of the label font: the pixel font's native 8 px grid. */
export const LABEL_FONT_CSS = 8
export const LABEL_GAP_CSS = 2
export const LABEL_SAME_NAME_CSS = 160

/**
 * The LOD layer of the renderer (requirement 25): draws the tiles within the detail radius of the hero from their bitmaps at far
 * zooms, draws street names, answers "which street is here" for a tap, and says which cells it covers. It holds no data of its
 * own: tiles and bitmaps live in the `LodStore`.
 */
export class LodLayer {
  private hero: LatLon | undefined
  private focus: LatLon[] = []
  private radiusM: number
  private readonly store: LodStore
  /** Labels drawn by the last `drawLabels` (tests). */
  lastLabels = 0

  constructor(store: LodStore, radiusM: number = DEFAULT_LOD_RADIUS_M) {
    this.store = store
    this.radiusM = radiusM
  }

  get radius(): number {
    return this.radiusM
  }

  setRadius(m: number): void {
    this.radiusM = m
  }

  setHero(hero: LatLon | undefined): void {
    this.hero = hero
  }

  /** Places away from the hero that get the full detail too (requirement 26.3). Redraws when they change. */
  setFocus(points: readonly LatLon[]): void {
    const same = points.length === this.focus.length && points.every((p, k) => p.lat === this.focus[k]!.lat && p.lon === this.focus[k]!.lon)
    if (same) return
    this.focus = [...points]
    this.store.changed()
  }

  /** Whether something at `distanceFrom(p)` metres from a point `p` is within the detail of the hero or of a focus point. */
  private reaches(distanceFrom: (p: LatLon) => number, centre: LatLon): boolean {
    if (distanceFrom(this.origin(centre)) <= this.radiusM) return true
    for (const f of this.focus) if (distanceFrom(f) <= FOCUS_RADIUS_M) return true
    return false
  }

  subscribe(fn: () => void): () => void {
    return this.store.subscribe(fn)
  }

  /** The point the detail radius is measured from: the hero, else the view centre. */
  private origin(centre: LatLon): LatLon {
    return this.hero ?? centre
  }

  /** The tiles of the scene window, nearest the screen centre first, with their device rectangles (shared integer edges). */
  private windowTiles(v: View, p: Projector): { id: TileId; x0: number; y0: number; w: number; h: number }[] {
    const tl = p.tileToLatLon((0 - v.originX) / v.scale, (0 - v.originY) / v.scale)
    const br = p.tileToLatLon((v.w - v.originX) / v.scale, (v.h - v.originY) / v.scale)
    const box: BBox = { south: Math.min(tl.lat, br.lat), north: Math.max(tl.lat, br.lat), west: Math.min(tl.lon, br.lon), east: Math.max(tl.lon, br.lon) }
    const midLat = (box.north + box.south) / 2
    const ex = (x: number) => Math.round(v.originX + p.toTileXY({ lat: midLat, lon: lonOf(x, LOD_Z) }).x * v.scale)
    const ey = (y: number) => Math.round(v.originY + p.toTileXY({ lat: latOf(y, LOD_Z), lon: box.west }).y * v.scale)
    const cx = v.w / 2
    const cy = v.h / 2
    return tilesInBBox(box, LOD_Z)
      .map((id) => {
        const x0 = ex(id.x)
        const y0 = ey(id.y)
        return { id, x0, y0, w: ex(id.x + 1) - x0, h: ey(id.y + 1) - y0 }
      })
      .filter((t) => t.w > 0 && t.h > 0)
      .sort((a, b) => Math.hypot(a.x0 + a.w / 2 - cx, a.y0 + a.h / 2 - cy) - Math.hypot(b.x0 + b.w / 2 - cx, b.y0 + b.h / 2 - cy))
  }

  /**
   * Draw the LOD look of every tile of the window that is within the radius (requirement 25.2, 25.3): its bitmap, a bitmap of another
   * level scaled while the right one is painted, or the ground-coloured placeholder. A tile whose download failed is left alone so the
   * coarse map under it shows. Does nothing above `FAR_ZOOM`.
   */
  drawBlocks(ctx: CanvasRenderingContext2D, v: View, p: Projector, centre: LatLon): BlocksDraw {
    const out: BlocksDraw = { bitmaps: 0, standIns: 0, placeholders: 0, skipped: 0, tiles: 0 }
    if (v.zoom > FAR_ZOOM) return out
    this.store.beginFrame()
    for (const t of this.windowTiles(v, p)) {
      if (!this.reaches((o) => distanceToTileM(t.id, o), centre)) {
        out.skipped++
        continue
      }
      out.tiles++
      const level = bitmapLevel(Math.max(t.w, t.h))
      this.store.want(t.id, level)
      const bm = this.store.bitmap(t.id, level)
      if (bm) {
        // Same size: copy as is. Another size: smoothed, so a thin street survives the scaling.
        ctx.imageSmoothingEnabled = t.w !== bm.level || t.h !== bm.level
        ctx.drawImage(bm.canvas, 0, 0, bm.level, bm.level, t.x0, t.y0, t.w, t.h)
        ctx.imageSmoothingEnabled = false
        if (bm.level === level) out.bitmaps++
        else out.standIns++
      } else if (this.store.state(t.id) === 'failed') out.skipped++
      else {
        ctx.fillStyle = P.overview.ground
        ctx.fillRect(t.x0, t.y0, t.w, t.h)
        out.placeholders++
      }
    }
    this.store.endFrame()
    return out
  }

  /** Street names of the window at this zoom, laid out without overlap (requirement 25.6). Returns how many were drawn. */
  drawLabels(ctx: CanvasRenderingContext2D, v: View, p: Projector): number {
    this.lastLabels = 0
    if (v.zoom < 0.5 || v.zoom >= LABEL_MAX_ZOOM) return 0
    const lines: LabelLine[] = []
    const reach = LABEL_FONT_CSS * v.dpr * 2
    for (const t of this.windowTiles(v, p)) {
      const tile = this.store.tile(t.id)
      if (!tile) continue
      const g = tile.names
      for (let i = 0; i < g.kind.length; i++) {
        const cls = g.kind[i]!
        if (v.zoom < labelMinZoom(cls)) continue
        const from = g.start[i]! * 2
        const to = g.start[i + 1]! * 2
        const pts: number[] = []
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (let j = from; j < to; j += 2) {
          const x = t.x0 + (g.xy[j]! / LOD_EXTENT) * t.w
          const y = t.y0 + (g.xy[j + 1]! / LOD_EXTENT) * t.h
          pts.push(x, y)
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
        // A street wholly outside the window (a label lies inside it) cannot give a label: it is not laid out at all (budget of requirement 24).
        if (x1 < -reach || y1 < -reach || x0 > v.w + reach || y0 > v.h + reach) continue
        lines.push({ text: g.text[i]!, rank: labelRank(cls), pts })
      }
    }
    if (!lines.length) return 0
    const fontPx = Math.round(LABEL_FONT_CSS * v.dpr)
    const placed = layoutLabels(lines, { width: v.w, height: v.h, fontPx, gap: LABEL_GAP_CSS * v.dpr, sameNameGap: LABEL_SAME_NAME_CSS * v.dpr, max: MAX_LABELS })
    ctx.font = `${fontPx}px "Press Start 2P", monospace`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    const halo = Math.max(1, Math.round(v.dpr))
    for (const l of placed) {
      ctx.save()
      if (l.vertical) {
        ctx.translate(l.x, l.y + l.h)
        ctx.rotate(-Math.PI / 2)
      } else ctx.translate(l.x, l.y)
      ctx.fillStyle = P.lod.labelHalo
      for (const [dx, dy] of [[-halo, 0], [halo, 0], [0, -halo], [0, halo], [-halo, -halo], [halo, halo], [-halo, halo], [halo, -halo]] as const) ctx.fillText(l.text, dx, dy)
      ctx.fillStyle = P.lod.label
      ctx.fillText(l.text, 0, 0)
      ctx.restore()
    }
    this.lastLabels = placed.length
    return placed.length
  }

  /** The street a tap at `at` means at this zoom (requirement 25.7). */
  snapAt(at: LatLon, zoom: number, metresPerTile: number): Snap | undefined {
    const maxM = snapRadiusM(zoom, metresPerTile)
    const near: ReturnType<LodStore['resident']>[number][] = []
    for (const t of this.store.resident()) if (distanceToTileM(t.id, at) <= maxM) near.push(t)
    return snapStreet(near, at, maxM)
  }

  /**
   * How a cell of the streamed world stands with the LOD layer (requirement 25.10): `no` when it is outside the radius (or a
   * tile of it failed, so the coarse layer must draw it), `loading` when it is covered but a tile is not in, else `ready`.
   */
  coverage(cell: CellId, centre?: LatLon): 'no' | 'loading' | 'ready' {
    if (!(this.hero ?? centre)) return 'no'
    const b = cellBBox(cell)
    if (!this.reaches((o) => distToBox(b, o), centre!)) return 'no'
    let loading = false
    for (const id of tilesInBBox(b, LOD_Z)) {
      const s = this.store.state(id)
      if (s === 'failed') return 'no'
      if (!this.store.has(id)) loading = true
    }
    return loading ? 'loading' : 'ready'
  }
}

/** Metres from `p` to the nearest point of a box. */
function distToBox(b: BBox, p: LatLon): number {
  const lat = Math.min(b.north, Math.max(b.south, p.lat))
  const lon = Math.min(b.east, Math.max(b.west, p.lon))
  const dy = (lat - p.lat) * 111_320
  const dx = (lon - p.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180)
  return Math.hypot(dx, dy)
}
