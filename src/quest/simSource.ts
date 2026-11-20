import type { LocationSource } from './geolocation.ts'
import { SimWalker, type SimOptions } from './simulate.ts'
import type { RouteTrack } from './snap.ts'

export type SimSourceOptions = Partial<SimOptions> & {
  /** Time warp: simulated seconds per real second. */
  timeScale: number
  /** Real milliseconds between ticks. */
  tickMs?: number
  /** Simulated seconds between emitted fixes (dense enough to see every checkpoint). */
  fixEverySimS?: number
}

/** A LocationSource that walks the route by itself (demo and testing). */
export function simulatedSource(track: RouteTrack, opts: SimSourceOptions): LocationSource {
  return {
    start(onFix) {
      const walker = new SimWalker(track, opts)
      const tickMs = opts.tickMs ?? 250
      const every = opts.fixEverySimS ?? 2
      let simS = 0
      let emittedUpTo = -every
      const timer = setInterval(() => {
        simS += (tickMs / 1000) * opts.timeScale
        while (emittedUpTo + every <= simS) {
          emittedUpTo += every
          onFix(walker.fixAt(emittedUpTo))
          // Keep a couple of fixes after arriving, then stop moving.
          if (walker.done(emittedUpTo - every * 3)) {
            clearInterval(timer)
            return
          }
        }
      }, tickMs)
      return () => clearInterval(timer)
    },
  }
}
