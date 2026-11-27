import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BACK_TOLERANCE_M, RouteLine, RouteWalker, type RoutePt } from './routeWalker.ts'
import { WalkerMotion } from './walkerMotion.ts'

/** A zig-zag route in tile units, 1 tile = 5 m, long enough for a long walk. */
function zigzag(n: number, seg = 12): RouteLine {
  const pts: RoutePt[] = []
  for (let i = 0; i <= n; i++) pts.push({ x: i * seg * (i % 2 ? 1 : 1), y: i % 3 === 0 ? 0 : i % 3 === 1 ? 20 : -15 })
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
  return new RouteLine(pts, len * 5)
}

const frames = fc.array(fc.double({ min: 4, max: 90, noNaN: true }), { minLength: 20, maxLength: 300 })

describe('RouteLine', () => {
  it('places points by metres and projects back', () => {
    const line = new RouteLine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 100)
    expect(line.mPerU).toBeCloseTo(5)
    expect(line.pointAt(25)).toMatchObject({ x: 5, y: 0 })
    expect(line.pointAt(75)).toMatchObject({ x: 10, y: 5 })
    expect(line.pointAt(1e9)).toMatchObject({ x: 10, y: 10 })
    expect(line.project({ x: 10.4, y: 5 }, 70).alongM).toBeCloseTo(75)
  })
})

describe('RouteWalker in a simulation', () => {
  const run = (speedMps: number, frameMs: number[], noise: boolean) => {
    const line = zigzag(80)
    const w = new RouteWalker()
    w.setLine(line)
    w.setSim(speedMps)
    w.observe(0, 0)
    const out: { t: number; along: number; dt: number }[] = []
    let t = 0
    let prev = 0
    let nextFix = 0
    for (const dt of frameMs) {
      t += dt
      while (nextFix <= t) {
        // Fixes arrive on their own timer; noisy ones can read behind the true progress.
        const truth = Math.min(line.totalM, speedMps * (nextFix / 1000))
        w.observe(Math.max(0, truth + (noise ? Math.sin(nextFix) * 5 : 0)), nextFix)
        nextFix += 2000 / (speedMps / (5 / 3.6))
      }
      const s = w.at(t)!
      out.push({ t, along: s.alongM, dt: t - prev })
      prev = t
    }
    return { out, line }
  }

  it.each([1, 5, 20])('property: at ×%i each frame advances speed × dt (±10 %) and never goes back', (x) => {
    const v = (5 / 3.6) * x
    fc.assert(
      fc.property(frames, fc.boolean(), (dts, noise) => {
        const { out, line } = run(v, dts, noise)
        let last = 0
        for (const f of out) {
          const adv = f.along - last
          expect(adv).toBeGreaterThanOrEqual(0)
          if (f.along < line.totalM - 1e-6) {
            expect(adv).toBeGreaterThanOrEqual(0.9 * v * (f.dt / 1000) - 1e-9)
            expect(adv).toBeLessThanOrEqual(1.1 * v * (f.dt / 1000) + 1e-9)
          }
          last = f.along
        }
      }),
      { seed: 7, numRuns: 40 },
    )
  })

  it('stops at the end of the route and stays there', () => {
    const line = new RouteLine([{ x: 0, y: 0 }, { x: 10, y: 0 }], 50)
    const w = new RouteWalker()
    w.setLine(line)
    w.setSim(5)
    w.observe(0, 0)
    w.observe(50, 100)
    expect(w.at(60_000)!.alongM).toBe(50)
    expect(w.isMoving(60_000)).toBe(false)
  })

  it('returns the same place for the same or an earlier time', () => {
    const w = new RouteWalker()
    w.setLine(zigzag(10))
    w.setSim(2)
    w.observe(0, 0)
    const a = w.at(1000)!
    expect(w.at(1000)).toEqual(a)
    expect(w.at(900)!.alongM).toBe(a.alongM)
  })

  it('places the hero after a jump (resume or reroute) instead of walking there', () => {
    const w = new RouteWalker()
    w.setLine(zigzag(40))
    w.setSim(2)
    w.observe(0, 0)
    w.at(100)
    w.observe(300, 200)
    expect(w.at(300)!.alongM).toBeGreaterThan(299)
  })
})

describe('RouteWalker with real GPS', () => {
  /** Drive the glide with noisy fixes along the route and sample the shown progress every frame. */
  function gps(noiseM: number, frameMs: number[], fixGap: number) {
    const line = zigzag(60)
    const motion = new WalkerMotion()
    const w = new RouteWalker()
    w.setLine(line)
    let t = 0
    let nextFix = 0
    let prevPt: RoutePt | undefined
    const shown: number[] = []
    let n = 0
    for (const dt of frameMs) {
      t += dt
      while (nextFix <= t) {
        const along = Math.min(line.totalM, 1.4 * (nextFix / 1000))
        // Noise along the route (what snapping turns GPS error into).
        const noisy = Math.max(0, Math.min(line.totalM, along + Math.sin(n * 12.9898) * noiseM))
        const p = line.pointAt(noisy)
        motion.moveTo(p, prevPt, t, false)
        prevPt = p
        w.observe(noisy, t)
        nextFix += fixGap
        n++
      }
      shown.push(w.at(t, motion.position(t))!.alongM)
    }
    return shown
  }

  it('property: displayed progress is monotonic across frames and fixes while GPS noise stays within the tolerance', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: BACK_TOLERANCE_M / 2, noNaN: true }), frames, fc.integer({ min: 300, max: 3000 }), (noise, dts, gap) => {
        const shown = gps(noise, dts, gap)
        for (let i = 1; i < shown.length; i++) expect(shown[i]!).toBeGreaterThanOrEqual(shown[i - 1]! - 1e-9)
      }),
      { seed: 11, numRuns: 60 },
    )
  })

  it('follows a user who really walks back, at the tolerance distance and without a jump', () => {
    const line = new RouteLine([{ x: 0, y: 0 }, { x: 200, y: 0 }], 1000)
    const w = new RouteWalker()
    w.setLine(line)
    w.observe(500, 0)
    w.at(0, { x: 100, y: 0 })
    let last = w.at(10, { x: 100, y: 0 })!.alongM
    for (let m = 500; m >= 300; m -= 10) {
      const s = w.at(1000 - m, { x: m / 5, y: 0 })!.alongM
      expect(last - s).toBeLessThanOrEqual(15)
      expect(s).toBeGreaterThanOrEqual(m)
      last = s
    }
    expect(last).toBeCloseTo(300 + BACK_TOLERANCE_M)
  })

  it('does not move back for a reading a few metres behind', () => {
    const line = new RouteLine([{ x: 0, y: 0 }, { x: 200, y: 0 }], 1000)
    const w = new RouteWalker()
    w.setLine(line)
    w.observe(500, 0)
    expect(w.at(0, { x: 100, y: 0 })!.alongM).toBeCloseTo(500)
    expect(w.at(10, { x: 98, y: 0 })!.alongM).toBeCloseTo(500)
  })
})
