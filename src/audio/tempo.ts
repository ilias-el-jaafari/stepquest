/**
 * Walking pace → music tempo. One beat per step feels natural: a relaxed
 * walk (1.3 m/s with a 0.75 m stride) is about 104 steps a minute, so the
 * chiptune plays at about 104 BPM, faster when you hurry.
 */

export const MIN_BPM = 84
export const MAX_BPM = 150
/** Steady, calm tempo for the planning screen (no walking yet). */
export const MENU_BPM = 80
/** Below this speed (m/s) the walker counts as standing still. */
export const STOP_SPEED = 0.35

/** Steps per minute for a speed and stride. */
export function cadence(speedMps: number, strideM: number): number {
  if (!(speedMps > 0) || !(strideM > 0)) return 0
  return (speedMps / strideM) * 60
}

/** Target tempo for a walking speed; undefined when standing still (music pauses). */
export function tempoForSpeed(speedMps: number, strideM: number): number | undefined {
  if (!(speedMps >= STOP_SPEED)) return undefined
  const c = cadence(speedMps, strideM)
  return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, c)))
}

/**
 * Glide the current tempo towards the target with a time constant (seconds),
 * and never by more than `maxPerSec` BPM a second, so changes are smooth.
 */
export function glideTempo(current: number, target: number, dtSec: number, tau = 2.5, maxPerSec = 12): number {
  if (!(dtSec > 0)) return current
  const k = 1 - Math.exp(-dtSec / tau)
  let step = (target - current) * k
  const cap = maxPerSec * dtSec
  step = Math.max(-cap, Math.min(cap, step))
  const next = current + step
  return Math.abs(target - next) < 0.05 ? target : next
}

type Sample = { t: number; m: number }

/**
 * Walking speed from the odometer over a sliding window of fix times (so the
 * simulator's warped clock gives real-world speeds). Wall-clock staleness is
 * checked separately with `isStale`.
 */
export class PaceTracker {
  private samples: Sample[] = []
  readonly windowMs: number
  constructor(windowMs = 12_000) {
    this.windowMs = windowMs
  }

  push(totalM: number, fixTime: number): void {
    const last = this.samples[this.samples.length - 1]
    if (last && fixTime <= last.t) {
      if (fixTime === last.t) last.m = totalM
      return
    }
    this.samples.push({ t: fixTime, m: totalM })
    const cutoff = fixTime - this.windowMs
    while (this.samples.length > 2 && this.samples[1]!.t <= cutoff) this.samples.shift()
  }

  /** Metres per second over the window, 0 with too little data. */
  speed(): number {
    const a = this.samples[0]
    const b = this.samples[this.samples.length - 1]
    if (!a || !b || b.t - a.t < 2000) return 0
    return Math.max(0, (b.m - a.m) / ((b.t - a.t) / 1000))
  }

  reset(): void {
    this.samples = []
  }
}

/** No fix for this long (wall clock) means we cannot tell if the walker moves: pause the music. */
export function isStale(lastFixWallMs: number | undefined, nowMs: number, limitMs = 10_000): boolean {
  return lastFixWallMs === undefined || nowMs - lastFixWallMs > limitMs
}
