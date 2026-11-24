import { facingFrom, type Facing } from './sprites.ts'

export type TilePt = { x: number; y: number }

/** How long the walker keeps its walk cycle after the last move. */
export const WALK_HOLD_MS = 1200
/** The tween between two fixes lasts as long as the gap between them, within these bounds. */
export const TWEEN_MIN_MS = 120
export const TWEEN_MAX_MS = 900

/**
 * Where the walker is between two GPS fixes, which way it faces and whether it is walking.
 * Pure: time and the reduced-motion preference come in as arguments.
 */
export class WalkerMotion {
  facing: Facing = 'down'
  private from: TilePt | undefined
  private to: TilePt | undefined
  private t0 = 0
  private ms = 0
  private movedAt = -Infinity

  /** Face the way the walker moved and tween to the new spot. */
  moveTo(to: TilePt, prev: TilePt | undefined, now: number, reduced: boolean): void {
    const from = prev ? (this.position(now) ?? prev) : undefined
    if (from) {
      const dx = to.x - from.x
      const dy = to.y - from.y
      if (Math.hypot(dx, dy) > 0.05) {
        this.facing = facingFrom(dx, dy, this.facing)
        this.movedAt = now
      }
    }
    // Tween over the gap since the last fix (capped), so motion looks continuous.
    this.ms = reduced || !from ? 0 : Math.max(TWEEN_MIN_MS, Math.min(TWEEN_MAX_MS, now - this.t0))
    this.from = from
    this.to = to
    this.t0 = now
  }

  position(now: number): TilePt | undefined {
    const to = this.to
    if (!to) return undefined
    if (!this.from || this.ms <= 0) return to
    const k = Math.min(1, (now - this.t0) / this.ms)
    return { x: this.from.x + (to.x - this.from.x) * k, y: this.from.y + (to.y - this.from.y) * k }
  }

  /** Walking: it moved within the last `WALK_HOLD_MS`. */
  isWalking(now: number, reduced: boolean): boolean {
    return now - this.movedAt < WALK_HOLD_MS && !reduced
  }

  /** A tween is still running (another frame is needed). */
  isTweening(now: number): boolean {
    return !!this.from && this.ms > 0 && now - this.t0 < this.ms
  }
}
