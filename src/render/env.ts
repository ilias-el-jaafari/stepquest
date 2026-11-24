/** Small environment probes shared by the map layers (kept in one place so tests can stub them). */

export const nowMs = (): number => (typeof performance === 'undefined' ? 0 : performance.now())

export const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Give a canvas's memory back (browsers, iOS Safari in particular, hold on to it until a GC that may never come). */
export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0
  c.height = 0
}
