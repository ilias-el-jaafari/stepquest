export type RoutePt = { x: number; y: number }

/** A real step back along the route must exceed this (metres) before the hero is shown going back. */
export const BACK_TOLERANCE_M = 15
/** In a simulated walk the hero may run ahead of the newest fix by this much (a fix is late, a tab slept)… */
export const SIM_LEAD_BASE_M = 20
/** …plus this many seconds of walking. */
export const SIM_LEAD_SECONDS = 1.5
/** A fix this far ahead of the hero is a jump (resume, reroute), not lag: the hero is placed there. */
export const SIM_JUMP_M = 60
/** The walk cycle keeps going this long after the hero last advanced. */
const MOVING_HOLD_MS = 350

/**
 * The route as a polyline in tile units, with distances in metres. `totalM` is the route's own length
 * (geodesic), so metres along the polyline match the metres the quest and the simulator count.
 */
export class RouteLine {
  readonly pts: readonly RoutePt[]
  readonly totalM: number
  private readonly cum: number[] = [0]
  private readonly lengthU: number
  /** Metres per tile unit along this polyline. */
  readonly mPerU: number

  constructor(pts: readonly RoutePt[], totalM: number) {
    this.pts = pts
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y))
    this.lengthU = this.cum[this.cum.length - 1] ?? 0
    this.mPerU = this.lengthU > 0 && totalM > 0 ? totalM / this.lengthU : 1
    this.totalM = this.lengthU > 0 && totalM > 0 ? totalM : this.lengthU
  }

  get isEmpty(): boolean {
    return this.pts.length === 0
  }

  /** Index i such that cum[i] <= u < cum[i+1] (the last segment for u at the end). */
  private segmentAt(u: number): number {
    let lo = 0
    let hi = this.cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid]! <= u) lo = mid
      else hi = mid
    }
    return lo
  }

  /** The point `alongM` metres along the route, with the direction of that stretch. */
  pointAt(alongM: number): { x: number; y: number; dx: number; dy: number } {
    const first = this.pts[0]
    if (!first) return { x: 0, y: 0, dx: 0, dy: 1 }
    if (this.pts.length === 1 || this.lengthU === 0) return { x: first.x, y: first.y, dx: 0, dy: 1 }
    const u = Math.min(this.lengthU, Math.max(0, alongM / this.mPerU))
    let i = this.segmentAt(u)
    // Skip zero-length segments so the heading is always real.
    while (i < this.pts.length - 2 && this.cum[i + 1]! - this.cum[i]! === 0) i++
    const a = this.pts[i]!
    const b = this.pts[i + 1]!
    const len = this.cum[i + 1]! - this.cum[i]!
    const k = len > 0 ? (u - this.cum[i]!) / len : 0
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y }
  }

  /** The place on the route nearest to `p`, looking only within a window of metres around `nearM`. */
  project(p: RoutePt, nearM: number, behindM = 80, aheadM = 400): { alongM: number; offsetU: number } {
    if (this.pts.length < 2) return { alongM: 0, offsetU: 0 }
    const from = Math.max(0, (nearM - behindM) / this.mPerU)
    const to = (nearM + aheadM) / this.mPerU
    let i = this.segmentAt(from)
    let best = { alongM: nearM, offsetU: Infinity }
    for (; i < this.pts.length - 1 && this.cum[i]! <= to; i++) {
      const a = this.pts[i]!
      const b = this.pts[i + 1]!
      const vx = b.x - a.x
      const vy = b.y - a.y
      const len2 = vx * vx + vy * vy
      const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
      const d = Math.hypot(p.x - (a.x + vx * k), p.y - (a.y + vy * k))
      if (d < best.offsetU) best = { alongM: (this.cum[i]! + k * Math.sqrt(len2)) * this.mPerU, offsetU: d }
    }
    return best
  }
}

export type WalkerShown = {
  x: number
  y: number
  /** Route progress shown, metres. */
  alongM: number
  /** Direction of the route stretch the hero is on. */
  dx: number
  dy: number
  /** The hero advanced a moment ago (drives the walk cycle). */
  moving: boolean
}

/**
 * The hero's place on the route, as the screen shows it. It works in route progress (metres along the
 * line), so the hero can only move along the route and never sideways or back through noise.
 *
 * - **Simulation** (`simMps` set: the simulator's walking speed times its time scale, in real m/s): the
 *   hero advances at that constant pace on the frame clock, whatever the fix times or noise. A fix only
 *   limits how far ahead it may run (`SIM_LEAD_*`), places it after a jump (resume, reroute) and does
 *   not otherwise steer it. It stops at the end of the route.
 * - **Real GPS**: the dead-reckoned glide position (`WalkerMotion`) is projected onto the route and the
 *   shown progress is clamped to be non-decreasing. A reading behind the shown progress by up to
 *   `BACK_TOLERANCE_M` is noise and is ignored; beyond that the user really walked back and the hero
 *   follows at the tolerance distance, without a jump.
 *
 * `at(now)` is called with the frame clock; calling it again with the same or an earlier time returns the
 * same place, so the sprite and the camera agree.
 */
export class RouteWalker {
  private line: RouteLine | undefined
  private simMps: number | undefined
  private s = 0
  private obsMax = 0
  private started = false
  private lastNow = -Infinity
  private movedAt = -Infinity

  /** A new route (or none): progress starts again from the next fix. */
  setLine(line: RouteLine | undefined): void {
    this.line = line && !line.isEmpty ? line : undefined
    this.started = false
    this.s = 0
    this.obsMax = 0
    this.lastNow = -Infinity
    this.movedAt = -Infinity
  }

  /** Real metres per second of the simulated hero, or undefined for a real GPS walk. */
  setSim(mps: number | undefined): void {
    this.simMps = mps !== undefined && mps > 0 ? mps : undefined
  }

  get isSim(): boolean {
    return this.simMps !== undefined
  }

  /** A fix: the route progress the quest reports. */
  observe(alongM: number, now: number): void {
    const line = this.line
    if (!line) return
    const a = Math.min(line.totalM, Math.max(0, alongM))
    this.obsMax = Math.max(this.obsMax, a)
    if (!this.started) {
      this.started = true
      this.s = a
      this.lastNow = now
      return
    }
    if (this.simMps !== undefined && a > this.s + SIM_JUMP_M) this.s = a
  }

  /** Shown progress now, metres (does not need the glide in a simulation). */
  at(now: number, glide?: RoutePt): WalkerShown | undefined {
    const line = this.line
    if (!line || !this.started) return undefined
    const prev = this.s
    if (now > this.lastNow) {
      const dt = now - this.lastNow
      if (this.simMps !== undefined) {
        const cap = Math.min(line.totalM, this.obsMax + SIM_LEAD_BASE_M + this.simMps * SIM_LEAD_SECONDS)
        // Constant pace; never faster than the cap and never back.
        this.s = Math.max(this.s, Math.min(this.s + (this.simMps * dt) / 1000, cap))
      } else if (glide) {
        const proj = line.project(glide, this.s)
        if (proj.alongM >= this.s) this.s = Math.min(line.totalM, proj.alongM)
        else if (this.s - proj.alongM > BACK_TOLERANCE_M) this.s = proj.alongM + BACK_TOLERANCE_M
      } else {
        this.s = Math.max(this.s, this.obsMax)
      }
      this.lastNow = now
      if (this.s > prev + 1e-9) this.movedAt = now
    }
    const p = line.pointAt(this.s)
    return { x: p.x, y: p.y, alongM: this.s, dx: p.dx, dy: p.dy, moving: now - this.movedAt < MOVING_HOLD_MS }
  }

  /** Another frame is needed: the hero still moves (simulation below its end, or still catching up). */
  isMoving(now: number): boolean {
    const line = this.line
    if (!line || !this.started) return false
    if (this.simMps !== undefined) return this.s < line.totalM - 1e-6
    return now - this.movedAt < MOVING_HOLD_MS
  }
}
