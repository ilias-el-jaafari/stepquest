/**
 * What one frame needs to know about where the map is on the canvas, in device
 * pixels. Built once per frame by the renderer and passed to every layer, so no
 * layer repeats the camera maths. Pure data plus two conversions.
 */
export type View = {
  /** Canvas size in device pixels. */
  w: number
  h: number
  /** Effective device pixels per CSS pixel (after the backing-store limit). */
  dpr: number
  /** CSS px per tile and the screen size in CSS px. */
  zoom: number
  cssW: number
  cssH: number
  /** Device px per tile. */
  scale: number
  /** Device position of tile (0, 0): an integer, so tiles stay on whole pixels. */
  originX: number
  originY: number
  /** Camera centre in tile units. */
  camX: number
  camY: number
  /** Device px of the canvas that lie outside the screen on every side (the cached scene's margin); absent or 0 when the canvas is the screen. */
  inset?: number
  /** True at or above `DETAIL_ZOOM`, where real tiles are drawn. */
  detail: boolean
}

export const screenX = (v: View, tx: number): number => v.originX + tx * v.scale
export const screenY = (v: View, ty: number): number => v.originY + ty * v.scale

/** Device pixel edge of tile column / row `g` (the same rounding for chunks, stand-ins and water). */
export const tileEdgeX = (v: View, g: number): number => Math.round(v.originX + g * v.scale)
export const tileEdgeY = (v: View, g: number): number => Math.round(v.originY + g * v.scale)
