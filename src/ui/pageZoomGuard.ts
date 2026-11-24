// Keeps the page itself from zooming on iOS Safari, which ignores `user-scalable=no`.
// Only the map canvas handles pinch (`mapInput.ts`); frames, HUD, sheets and fixed controls never zoom.

/** The element that owns pinch and pan: the map canvas. */
export const MAP_CANVAS_SELECTOR = '.map-canvas'

/** The viewport content the page must keep (also written in `index.html`). */
export const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const

export function isInsideMap(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(MAP_CANVAS_SELECTOR) !== null
}

function blockGesture(e: Event): void {
  if (!isInsideMap(e.target)) e.preventDefault()
}

function blockMultiTouch(e: Event): void {
  const touches = (e as TouchEvent).touches
  if (touches && touches.length > 1 && !isInsideMap(e.target)) e.preventDefault()
}

/** Puts the page back to scale 1 when it was zoomed anyway (best effort: Safari has no API for it). */
export function resetPageZoom(doc: Document = document, vv: VisualViewport | null = window.visualViewport): void {
  if (!vv || vv.scale <= 1.001) return
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (meta) {
    // Rewriting the content makes Safari apply the scale limits again.
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1')
    meta.setAttribute('content', LOCKED_VIEWPORT)
  }
  window.scrollTo(0, 0)
}

/** Installs the document-level guards; returns a function that removes them. */
export function installPageZoomGuard(doc: Document = document): () => void {
  const opts = { passive: false } as const
  for (const type of GESTURE_EVENTS) doc.addEventListener(type, blockGesture, opts)
  doc.addEventListener('touchstart', blockMultiTouch, opts)
  doc.addEventListener('touchmove', blockMultiTouch, opts)
  const vv = window.visualViewport
  const onResize = () => resetPageZoom(doc, vv)
  vv?.addEventListener('resize', onResize)
  return () => {
    for (const type of GESTURE_EVENTS) doc.removeEventListener(type, blockGesture)
    doc.removeEventListener('touchstart', blockMultiTouch)
    doc.removeEventListener('touchmove', blockMultiTouch)
    vv?.removeEventListener('resize', onResize)
  }
}
