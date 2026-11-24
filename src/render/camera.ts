/**
 * The map camera: where the screen looks, how far in, and the conversions
 * between screen pixels and tile coordinates. Pure (no DOM, no projection):
 * the renderer converts lat/lon to tiles before calling.
 */

/** Screen pixels per tile. ≥ DETAIL_ZOOM draws real 16×16 tiles; below it, a 1-px-per-tile town map. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 16, 24, 32, 48] as const
export const DETAIL_ZOOM = 8

export type Pt = { x: number; y: number }

/** The next ladder level above (`1`) or below (`-1`) `zoom`, which may lie between two levels. Stays at the ends. */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  const eps = 1e-9
  if (direction > 0) return ZOOM_LEVELS.find((z) => z > zoom + eps) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) if (ZOOM_LEVELS[i]! < zoom - eps) return ZOOM_LEVELS[i]!
  return ZOOM_LEVELS[0]
}

/** The ladder level nearest to `zoom` on a log scale. */
export function nearestZoom(zoom: number): number {
  let best: number = ZOOM_LEVELS[0]
  for (const z of ZOOM_LEVELS) if (Math.abs(Math.log(z / zoom)) < Math.abs(Math.log(best / zoom))) best = z
  return best
}

export class Camera {
  /** Camera centre in tile units and zoom in CSS px per tile. */
  x: number
  y: number
  zoom = 16
  /** Screen size in CSS px (set by the renderer from the canvas). */
  width = 0
  height = 0

  readonly cols: number
  readonly rows: number

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.x = cols / 2
    this.y = rows / 2
  }

  setSize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  screenToTile(sx: number, sy: number): Pt {
    return { x: this.x + (sx - this.width / 2) / this.zoom, y: this.y + (sy - this.height / 2) / this.zoom }
  }

  tileToScreen(tx: number, ty: number): Pt {
    return { x: this.width / 2 + (tx - this.x) * this.zoom, y: this.height / 2 + (ty - this.y) * this.zoom }
  }

  /** The camera may go half a screen past the loaded area, so the map can offer loading the next one. */
  clamp(): void {
    const mx = this.width / 2 / this.zoom
    const my = this.height / 2 / this.zoom
    this.x = Math.max(-mx, Math.min(this.cols + mx, this.x))
    this.y = Math.max(-my, Math.min(this.rows + my, this.y))
  }

  panBy(dxCss: number, dyCss: number): void {
    this.x -= dxCss / this.zoom
    this.y -= dyCss / this.zoom
    this.clamp()
  }

  centerOn(tx: number, ty: number, zoom?: number): void {
    this.x = tx
    this.y = ty
    if (zoom) this.zoom = zoom
  }

  /** Zoom to `zoom`, keeping the tile under (sx, sy) fixed on screen. */
  zoomTo(zoom: number, sx = this.width / 2, sy = this.height / 2): void {
    const before = this.screenToTile(sx, sy)
    this.zoom = zoom
    const after = this.screenToTile(sx, sy)
    this.x += before.x - after.x
    this.y += before.y - after.y
    this.clamp()
  }

  zoomStep(direction: 1 | -1, sx = this.width / 2, sy = this.height / 2): void {
    this.zoomTo(nextZoom(this.zoom, direction), sx, sy)
  }

  /** Frame a set of tile points with the largest ladder zoom that fits. */
  fit(points: readonly Pt[], paddingPx = 48): void {
    if (points.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const t of points) {
      minX = Math.min(minX, t.x)
      minY = Math.min(minY, t.y)
      maxX = Math.max(maxX, t.x)
      maxY = Math.max(maxY, t.y)
    }
    const w = Math.max(1, this.width - paddingPx * 2)
    const h = Math.max(1, this.height - paddingPx * 2)
    const needed = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY))
    let zoom: number = ZOOM_LEVELS[0]
    for (const z of ZOOM_LEVELS) if (z <= needed) zoom = z
    this.zoom = zoom
    this.x = (minX + maxX) / 2
    this.y = (minY + maxY) / 2
  }
}
