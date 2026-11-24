import { nextZoom } from './camera.ts'

/**
 * Pure gesture decisions for the map (no DOM): wheel steps, pinch level, drag velocity and glide,
 * double-tap pairing. `ui/mapInput.ts` feeds them pointer and wheel events and applies the results
 * to the renderer.
 */

/** One zoom level per this many pixels of wheel travel (a mouse notch is 100). */
export const WHEEL_STEP_PX = 100
/** Partial wheel travel is forgotten after this much silence. */
export const WHEEL_IDLE_MS = 250
const LINE_PX = 34
const PAGE_PX = 100

/** Turns wheel and trackpad scroll events into whole zoom steps. */
export class WheelAccumulator {
  private sum = 0
  private last = -Infinity

  /** Zoom steps for one event: positive zooms in (scrolling up), negative out, 0 for a partial step. */
  push(deltaY: number, deltaMode: number, now: number): number {
    if (deltaY === 0 || !Number.isFinite(deltaY)) return 0
    const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY
    if (now - this.last > WHEEL_IDLE_MS || Math.sign(px) !== Math.sign(this.sum)) this.sum = 0
    this.last = now
    this.sum += px
    const whole = Math.trunc(this.sum / WHEEL_STEP_PX)
    this.sum -= whole * WHEEL_STEP_PX
    return whole === 0 ? 0 : -whole
  }
}

/** A pinch has to pass the midpoint between two levels by this factor before the level changes. */
export const PINCH_HYSTERESIS = 1.08

/**
 * The ladder level for a pinch whose finger spread asks for `target` zoom, given the level in
 * force. Level changes only past the geometric midpoint to the next level times the hysteresis,
 * so a target that holds still never flips between two levels.
 */
export function pinchLevel(target: number, current: number): number {
  let z = current
  for (;;) {
    const up = nextZoom(z, 1)
    if (up !== z && target > Math.sqrt(z * up) * PINCH_HYSTERESIS) z = up
    else break
  }
  for (;;) {
    const down = nextZoom(z, -1)
    if (down !== z && target < Math.sqrt(z * down) / PINCH_HYSTERESIS) z = down
    else break
  }
  return z
}

export type Velocity = { vx: number; vy: number }

/** Drag velocity (px per ms) from the pointer samples of the last 100 ms. */
export class VelocityTracker {
  private samples: { x: number; y: number; t: number }[] = []

  reset(): void {
    this.samples = []
  }

  add(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t })
    while (this.samples.length > 2 && t - this.samples[0]!.t > 100) this.samples.shift()
  }

  /** Velocity at release time `now`; zero when the pointer rested for 100 ms or more before release. */
  velocity(now: number): Velocity {
    const s = this.samples
    const last = s[s.length - 1]
    const first = s[0]
    if (!last || !first || last === first || now - last.t > 100) return { vx: 0, vy: 0 }
    const dt = last.t - first.t
    return dt > 0 ? { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt } : { vx: 0, vy: 0 }
  }
}

/** A release faster than this starts a glide; a glide slower than `GLIDE_STOP` ends. Both in px per ms. */
export const GLIDE_START = 0.05
export const GLIDE_STOP = 0.02
/** Glide speed falls by 1/e every this many ms. */
export const GLIDE_TAU_MS = 250

export const speed = (v: Velocity): number => Math.hypot(v.vx, v.vy)

/** Advance a glide by `dtMs`: the distance travelled (exact integral of the decay) and the new velocity. */
export function glideStep(v: Velocity, dtMs: number): { dx: number; dy: number; next: Velocity } {
  const f = Math.exp(-dtMs / GLIDE_TAU_MS)
  const k = GLIDE_TAU_MS * (1 - f)
  return { dx: v.vx * k, dy: v.vy * k, next: { vx: v.vx * f, vy: v.vy * f } }
}

export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_PX = 24

/** Pairs two quick taps close to each other into a double tap (a third tap starts over). */
export class TapPairer {
  private last: { x: number; y: number; t: number } | undefined

  tap(x: number, y: number, now: number): 'single' | 'double' {
    const p = this.last
    if (p && now - p.t <= DOUBLE_TAP_MS && Math.hypot(x - p.x, y - p.y) <= DOUBLE_TAP_PX) {
      this.last = undefined
      return 'double'
    }
    this.last = { x, y, t: now }
    return 'single'
  }
}

/** Pixels moved per arrow key press. */
export const KEY_PAN_PX = 64
