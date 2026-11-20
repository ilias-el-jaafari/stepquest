import { destination, type LatLon } from '../geo/geo.ts'
import { pointAlong } from '../routing/checkpoints.ts'
import type { RouteTrack } from './snap.ts'
import type { GpsFix } from './types.ts'

export type SimOptions = {
  /** Walking speed, km/h. */
  speedKmh: number
  /** Standard deviation of synthetic GPS noise, metres (0 = perfect). */
  noiseM: number
  /** Occasionally emit a wild outlier (to show the filter at work). */
  glitches: boolean
  seed: number
  /** Resume from this far along the route. */
  startAlongM: number
  /** Simulated clock at the start, ms. */
  startTime: number
}

export const DEFAULT_SIM: SimOptions = { speedKmh: 5, noiseM: 4, glitches: false, seed: 1, startAlongM: 0, startTime: 0 }

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Walks a virtual person along a route and produces GPS-like fixes. */
export class SimWalker {
  private readonly track: RouteTrack
  private readonly opts: SimOptions
  private readonly rand: () => number
  private count = 0

  constructor(track: RouteTrack, opts: Partial<SimOptions> = {}) {
    this.track = track
    this.opts = { ...DEFAULT_SIM, ...opts }
    this.rand = prng(this.opts.seed)
  }

  get speedMps(): number {
    return this.opts.speedKmh / 3.6
  }

  alongAt(simSeconds: number): number {
    return Math.min(this.track.total, this.opts.startAlongM + this.speedMps * simSeconds)
  }

  truePositionAt(simSeconds: number): LatLon {
    return pointAlong(this.track.points, this.track.cumulative, this.alongAt(simSeconds))
  }

  done(simSeconds: number): boolean {
    return this.alongAt(simSeconds) >= this.track.total
  }

  private gaussian(): number {
    // Box–Muller.
    const u = Math.max(1e-12, this.rand())
    const v = this.rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  fixAt(simSeconds: number): GpsFix {
    this.count++
    let p = this.truePositionAt(simSeconds)
    const { noiseM } = this.opts
    if (noiseM > 0) {
      const dx = this.gaussian() * noiseM
      const dy = this.gaussian() * noiseM
      p = destination(destination(p, 90, dx), 0, dy)
      if (this.opts.glitches && this.count % 45 === 0) p = destination(p, this.rand() * 360, 150 + this.rand() * 100)
    }
    return {
      lat: p.lat,
      lon: p.lon,
      accuracy: noiseM > 0 ? Math.max(5, Math.round(noiseM * 1.6)) : 5,
      timestamp: this.opts.startTime + simSeconds * 1000,
    }
  }
}
