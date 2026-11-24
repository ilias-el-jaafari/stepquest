import type { LatLon } from '../geo/geo.ts'
import { KEY_PAN_PX, glideStep, GLIDE_START, GLIDE_STOP, pinchLevel, speed, TapPairer, VelocityTracker, WheelAccumulator, type Velocity } from '../render/gestures.ts'
import type { MapRenderer } from '../render/MapRenderer.ts'

/** What the map tells the app about the user's gestures. */
export type MapInputHandlers = {
  /** A single tap or click: the map point under it. */
  tap(p: LatLon): void
  /** The user moved the map (so follow mode can switch off). */
  userPan(): void
  /** The map came to rest: its centre (to offer loading that area). */
  view(centre: LatLon): void
}

const TAP_SLOP_PX = 8
const VIEW_DEBOUNCE_MS = 150

type P = { x: number; y: number }

/**
 * Binds pointer, wheel and keyboard events on the map canvas to the renderer, using the pure
 * decisions of `render/gestures.ts`: one finger or the mouse pans (and glides on release), two
 * fingers pinch to the nearest zoom level and pan with their midpoint, a quick second tap zooms in,
 * the wheel zooms one level per 100 px, arrow keys pan and plus/minus zoom. `handlers` is read at
 * each event, so the caller can swap callbacks without re-binding. Returns the function that unbinds.
 */
export function attachMapInput(canvas: HTMLCanvasElement, renderer: MapRenderer, handlers: () => MapInputHandlers): () => void {
  const pointers = new Map<number, P>()
  const velocity = new VelocityTracker()
  const wheel = new WheelAccumulator()
  const taps = new TapPairer()
  let rect: DOMRect | undefined
  let moved = 0
  let pinchStart = 0
  let pinchZoom = renderer.zoom
  let lastMid: P | undefined
  let viewTimer: ReturnType<typeof setTimeout> | undefined
  let glideFrame: number | undefined
  let glideTimer: ReturnType<typeof setTimeout> | undefined

  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const reportView = () => {
    clearTimeout(viewTimer)
    viewTimer = setTimeout(() => handlers().view(renderer.screenToLatLon(renderer.cssWidth / 2, renderer.cssHeight / 2)), VIEW_DEBOUNCE_MS)
  }
  const local = (e: PointerEvent): P => {
    const r = (rect ??= canvas.getBoundingClientRect())
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const two = (): [P, P] => [...pointers.values()] as [P, P]

  const stopGlide = () => {
    if (glideFrame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glideFrame)
    glideFrame = undefined
    clearTimeout(glideTimer)
    glideTimer = undefined
  }
  const glide = (start: Velocity) => {
    let v = start
    let last = now()
    const step = () => {
      glideFrame = undefined
      glideTimer = undefined
      const t = now()
      const dt = Math.min(64, Math.max(1, t - last))
      last = t
      const s = glideStep(v, dt)
      renderer.panBy(s.dx, s.dy)
      handlers().userPan()
      v = s.next
      if (speed(v) > GLIDE_STOP) schedule()
      else reportView()
    }
    const schedule = () => {
      if (typeof requestAnimationFrame === 'function') glideFrame = requestAnimationFrame(step)
      else glideTimer = setTimeout(step, 16)
    }
    schedule()
  }

  const down = (e: PointerEvent) => {
    // Only the primary button of a mouse (right and middle clicks belong to the browser).
    if (e.pointerType === 'mouse' && e.button !== 0) return
    stopGlide()
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // The pointer is already gone (a fast tap); the gesture still works without capture.
    }
    rect = canvas.getBoundingClientRect()
    const p = local(e)
    pointers.set(e.pointerId, p)
    if (pointers.size === 1) {
      moved = 0
      velocity.reset()
      velocity.add(p.x, p.y, now())
    }
    if (pointers.size === 2) {
      const [a, b] = two()
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
      pinchZoom = renderer.zoom
      lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      moved = TAP_SLOP_PX + 1
      velocity.reset()
    }
  }

  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    pointers.set(e.pointerId, p)
    if (pointers.size === 1) {
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)
      if (moved > TAP_SLOP_PX) {
        renderer.panBy(p.x - prev.x, p.y - prev.y)
        velocity.add(p.x, p.y, now())
        handlers().userPan()
      }
    } else if (pointers.size === 2 && pinchStart > 0) {
      const [a, b] = two()
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (lastMid) renderer.panBy(mid.x - lastMid.x, mid.y - lastMid.y)
      lastMid = mid
      const level = pinchLevel(pinchZoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart), renderer.zoom)
      if (level !== renderer.zoom) renderer.zoomTo(level, mid.x, mid.y)
      handlers().userPan()
    }
  }

  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (pointers.size < 2) {
      pinchStart = 0
      lastMid = undefined
    }
    if (!p || pointers.size > 0) return
    if (moved <= TAP_SLOP_PX && e.type === 'pointerup') {
      // A second quick tap near the first zooms in; it does not place another point.
      if (taps.tap(p.x, p.y, now()) === 'double') {
        renderer.zoomStep(1, p.x, p.y)
        reportView()
      } else handlers().tap(renderer.screenToLatLon(p.x, p.y))
      return
    }
    const v = e.type === 'pointerup' && moved > TAP_SLOP_PX ? velocity.velocity(now()) : { vx: 0, vy: 0 }
    if (speed(v) > GLIDE_START && !reduced()) glide(v)
    else reportView()
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const steps = wheel.push(e.deltaY, e.deltaMode, now())
    if (steps === 0) return
    const r = canvas.getBoundingClientRect()
    for (let i = 0; i < Math.abs(steps); i++) renderer.zoomStep(steps > 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top)
    reportView()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const pan: Record<string, [number, number]> = { ArrowLeft: [KEY_PAN_PX, 0], ArrowRight: [-KEY_PAN_PX, 0], ArrowUp: [0, KEY_PAN_PX], ArrowDown: [0, -KEY_PAN_PX] }
    const d = pan[e.key]
    if (d) renderer.panBy(d[0], d[1])
    else if (e.key === '+' || e.key === '=') renderer.zoomStep(1)
    else if (e.key === '-' || e.key === '_') renderer.zoomStep(-1)
    else return
    e.preventDefault()
    if (d) handlers().userPan()
    reportView()
  }

  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKey)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('keydown', onKey)
    clearTimeout(viewTimer)
    stopGlide()
  }
}
