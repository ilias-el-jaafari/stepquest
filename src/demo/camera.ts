export type TilePt = { x: number; y: number }
export type TileBounds = { minX: number; minY: number; maxX: number; maxY: number }

export type ShotInput = {
  /** 0 (close on the walker) to 1 (the whole route). */
  blend: number
  player: TilePt
  bounds: TileBounds
  viewport: { w: number; h: number }
  closeZoom: number
  /** The lowest zoom the view may have (the quest floor). */
  minZoom: number
  paddingPx?: number
}

/** The zoom (screen px per tile) at which `bounds` just fits the viewport. */
export function fitZoom(bounds: TileBounds, viewport: { w: number; h: number }, paddingPx = 48): number {
  const w = Math.max(1, viewport.w - paddingPx * 2)
  const h = Math.max(1, viewport.h - paddingPx * 2)
  return Math.min(w / Math.max(1, bounds.maxX - bounds.minX), h / Math.max(1, bounds.maxY - bounds.minY))
}

/** The camera for a blend: zoom moves on a log scale and the centre slides from the walker to the route's middle. */
export function shotAt(i: ShotInput): { x: number; y: number; zoom: number } {
  const b = Math.min(1, Math.max(0, Number.isFinite(i.blend) ? i.blend : 0))
  const whole = Math.min(i.closeZoom, Math.max(i.minZoom, fitZoom(i.bounds, i.viewport, i.paddingPx)))
  const zoom = b === 0 ? i.closeZoom : b === 1 ? whole : i.closeZoom * (whole / i.closeZoom) ** b
  const cx = (i.bounds.minX + i.bounds.maxX) / 2
  const cy = (i.bounds.minY + i.bounds.maxY) / 2
  return { x: i.player.x + (cx - i.player.x) * b, y: i.player.y + (cy - i.player.y) * b, zoom }
}
