import { facingFrom, type Facing } from './sprites.ts'

export type TilePt = { x: number; y: number }

/** Walk cycle hold after the last move: at least this long, and 1.5 fix intervals when fixes are rarer. */
export const WALK_HOLD_MS = 1200
export const WALK_HOLD_MAX_MS = 4000
/** How quickly the shown position closes in on where the walker should be (time constant, ms). */
export const FOLLOW_TAU_MS = 220
/** The walker keeps going at the last speed for at most this many fix intervals while it waits for the next fix. */
export const EXTRAPOLATE_INTERVALS = 1.25
/** Fixes further apart than this (tiles) are a jump (a reroute, a resume): the walker is placed, not walked. */
export const TELEPORT_TILES = 40
/** Within this many tiles of its target and with no speed, the walker is at rest. */
const REST_TILES = 0.004
const MIN_FIX_GAP_MS = 40
const MAX_FIX_GAP_MS = 6000

/**
 * Where the walker is drawn between GPS fixes, which way it faces and whether it is walking.
 *
 * The shown position is a function of the clock only (no per-frame state), so it does not depend on the
 * frame rate and it is the same wherever it is sampled in a frame (sprite and camera agree):
 * the target moves on from the newest fix at the speed measured between the last two fixes (for at most
 * 1.25 fix intervals), and the shown position follows that target with an exponential lag whose closed
 * form is evaluated at `now`. At a steady pace the speed is constant between fixes and across them, so
 * the hero glides at ×1 (a fix every 2 s) as at ×20 (a fix every 250 ms). Pure: time and the
 * reduced-motion preference come in as arguments.
 */
export class WalkerMotion {
  facing: Facing = 'down'
  /** Newest fix, the speed in tiles per ms measured from the fixes, and the typical gap between fixes. */
  private fix: TilePt | undefined
  private fixAt = 0
  private vx = 0
  private vy = 0
  private gapMs = 0
  /** The shown position when the newest fix arrived. */
  private from: TilePt | undefined
  private still = true
  private movedAt = -Infinity

  /** A new fix: face the way the walker moved and re-aim the glide. */
  moveTo(to: TilePt, prev: TilePt | undefined, now: number, reduced: boolean): void {
    const shown = this.position(now)
    const last = this.fix
    if (!last || !prev || reduced || !shown || Math.hypot(to.x - shown.x, to.y - shown.y) > TELEPORT_TILES) {
      this.fix = to
      this.fixAt = now
      this.from = to
      this.vx = 0
      this.vy = 0
      this.gapMs = 0
      this.still = true
      return
    }
    const gap = now - this.fixAt
    const dx = to.x - last.x
    const dy = to.y - last.y
    if (Math.hypot(dx, dy) > 0.05) {
      this.facing = facingFrom(dx, dy, this.facing)
      this.movedAt = now
    }
    if (gap >= MIN_FIX_GAP_MS && gap <= MAX_FIX_GAP_MS) {
      // Speed from the last two fixes, smoothed a little so a late fix does not jerk the pace.
      const k = this.gapMs === 0 ? 1 : 0.6
      this.vx += (dx / gap - this.vx) * k
      this.vy += (dy / gap - this.vy) * k
      this.gapMs = this.gapMs === 0 ? gap : this.gapMs + (gap - this.gapMs) * 0.5
      this.still = false
    } else if (gap > MAX_FIX_GAP_MS) {
      this.vx = 0
      this.vy = 0
      this.gapMs = 0
    }
    this.from = shown
    this.fix = to
    this.fixAt = now
  }

  /** Time the target keeps moving after a fix. */
  private get cap(): number {
    return this.gapMs * EXTRAPOLATE_INTERVALS
  }

  position(now: number): TilePt | undefined {
    const fix = this.fix
    const from = this.from
    if (!fix || !from) return undefined
    if (this.still) return fix
    const t = Math.max(0, now - this.fixAt)
    const cap = this.cap
    const moving = Math.min(t, cap)
    // Target at time t: the fix plus the speed times the (capped) time since it.
    const tx = fix.x + this.vx * moving
    const ty = fix.y + this.vy * moving
    // Following a target that moves at v with lag tau: p(t) = target(t) - v tau + (p0 - target(0) + v tau) e^(-t/tau).
    const tau = FOLLOW_TAU_MS
    const e = Math.exp(-moving / tau)
    let px = tx - this.vx * tau + (from.x - fix.x + this.vx * tau) * e
    let py = ty - this.vy * tau + (from.y - fix.y + this.vy * tau) * e
    if (t > cap) {
      // The target has stopped (no fix for a while): the position settles on it.
      const e2 = Math.exp(-(t - cap) / tau)
      px = tx + (px - tx) * e2
      py = ty + (py - ty) * e2
    }
    return { x: px, y: py }
  }

  /** Walking: it moved within the last stretch between fixes. */
  isWalking(now: number, reduced: boolean): boolean {
    const hold = Math.min(WALK_HOLD_MAX_MS, Math.max(WALK_HOLD_MS, this.gapMs * 1.5))
    return now - this.movedAt < hold && !reduced
  }

  /** The shown position is still moving (another frame is needed). */
  isTweening(now: number): boolean {
    if (this.still || !this.fix) return false
    const t = now - this.fixAt
    if (t < this.cap) return true
    const p = this.position(now)!
    const target = { x: this.fix.x + this.vx * this.cap, y: this.fix.y + this.vy * this.cap }
    return Math.hypot(p.x - target.x, p.y - target.y) > REST_TILES
  }
}
