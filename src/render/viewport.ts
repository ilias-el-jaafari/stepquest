/**
 * Canvas backing store and pixel ratio. `backingSize` is pure; `watchPixelRatio`
 * is the one DOM piece (a media query that fires when the ratio changes without
 * the canvas changing size, e.g. a window dragged to another screen).
 */

/** Largest backing store: 8192 px per side and iOS Safari's 16 777 216 px canvas area. */
export const MAX_SIDE = 8192
export const MAX_PIXELS = 16_777_216

/**
 * The most device pixels per CSS pixel the canvas backs. A 3× phone would fill 2.25 times the pixels of a 2× backing
 * for no visible gain on 16 × 16 pixel art (the browser scales the canvas up with nearest-neighbour, `image-rendering: pixelated`).
 */
export const MAX_DPR = 2

/** The ratio the canvas is backed at for a screen ratio. */
export const backingRatio = (dpr: number): number => (dpr > 0 && Number.isFinite(dpr) ? Math.min(dpr, MAX_DPR) : 1)

export type Backing = { w: number; h: number; /** Effective device pixels per CSS pixel. */ dpr: number }

/** Backing-store size for a CSS size and pixel ratio, lowering the ratio when the limits would be exceeded. */
export function backingSize(cssW: number, cssH: number, dpr: number, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS): Backing {
  const ratio = backingRatio(dpr)
  let w = Math.round(cssW * ratio)
  let h = Math.round(cssH * ratio)
  let eff = ratio
  if (w > 0 && h > 0 && (w > maxSide || h > maxSide || w * h > maxPixels)) {
    const k = Math.min(maxSide / w, maxSide / h, Math.sqrt(maxPixels / (w * h)))
    eff = ratio * k
    w = Math.floor(cssW * eff)
    h = Math.floor(cssH * eff)
    // Floor can leave the product a hair over because of float error; trim until inside.
    while (w * h > maxPixels || w > maxSide || h > maxSide) {
      if (w >= h) w--
      else h--
    }
  }
  return { w, h, dpr: eff }
}

/** Calls `onChange` whenever `devicePixelRatio` changes; returns the stop function. */
export function watchPixelRatio(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function' || typeof devicePixelRatio !== 'number') return () => {}
  let stopped = false
  let query: MediaQueryList | undefined
  const arm = () => {
    query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    query.addEventListener?.('change', fire, { once: true })
  }
  const fire = () => {
    if (stopped) return
    arm()
    onChange()
  }
  arm()
  return () => {
    stopped = true
    query?.removeEventListener?.('change', fire)
  }
}
