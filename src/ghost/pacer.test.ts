import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RouteLine } from '../render/routeWalker.ts'
import { GHOST_FRAMES, GHOST_BOO, GHOST_HAPPY, GHOST_FLOAT, ghostBob, ghostPhase, ghostSprite } from './art.ts'
import { spriteIsValid } from '../render/sprites.ts'
import {
  ENTER_M, EXIT_M, GHOST_LEAD_M, WARMUP_MS, ghostAlongM, nextPacerStatus, pacerAlongM, pacerDistanceM, pacerElapsedMs, pacerGapM, paceFor, pausePacer, rebasePacer, resumePacer, startPacer, type PacerStatus,
} from './pacer.ts'

const pace = paceFor(0.75)

describe('paceFor', () => {
  it('defaults to a brisk 5 km/h, about 110 steps a minute at 0.75 m', () => {
    expect(pace.kmh).toBe(5)
    expect(pace.stepsPerMin).toBeCloseTo(111.1, 1)
  })
  it('follows a suggested duration, kept between a stroll and a fast walk', () => {
    expect(paceFor(0.75, { distanceM: 6000, durationMin: 60 }).kmh).toBe(6)
    expect(paceFor(0.75, { distanceM: 6000, durationMin: 10 }).kmh).toBe(7)
    expect(paceFor(0.75, { distanceM: 1000, durationMin: 60 }).kmh).toBe(3)
  })
  it('property: steps per minute scale inversely with the stride', () => {
    fc.assert(fc.property(fc.double({ min: 0.4, max: 1.2, noNaN: true }), (stride) => {
      const p = paceFor(stride)
      expect(p.stepsPerMin * stride).toBeCloseTo((p.mps * 60), 6)
    }))
  })
})

describe('pacer distance', () => {
  it('is pace × elapsed time and runs at the simulator rate', () => {
    const plan = startPacer(1000, pace, { rate: 1 })
    expect(pacerDistanceM(plan, 1000 + 60_000)).toBeCloseTo(pace.mps * 60)
    expect(pacerDistanceM(startPacer(0, pace, { rate: 20 }), 3000)).toBeCloseTo(pace.mps * 60)
  })
  it('starts where the hero is on a resume', () => {
    const plan = startPacer(0, pace, { alongM: 500 })
    expect(pacerDistanceM(plan, 0)).toBeCloseTo(500)
  })
  it('property: paused time does not count and the distance never decreases', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 20_000 }), fc.boolean()), { minLength: 1, maxLength: 30 }), (steps) => {
        let plan = startPacer(0, pace)
        let t = 0
        let running = 0
        let last = 0
        let paused = false
        for (const [dt, pause] of steps) {
          t += dt
          if (!paused) running += dt
          const d = pacerDistanceM(plan, t)
          expect(d).toBeGreaterThanOrEqual(last - 1e-9)
          last = d
          plan = pause ? pausePacer(plan, t) : resumePacer(plan, t)
          paused = pause
        }
        expect(pacerElapsedMs(plan, t)).toBeCloseTo(running, 6)
        // Frozen while paused.
        if (paused) expect(pacerDistanceM(plan, t + 99_999)).toBeCloseTo(pacerDistanceM(plan, t), 9)
      }),
    )
  })
  it('keeps the gap to the hero when the route is recalculated', () => {
    let plan = startPacer(0, pace)
    const now = 100_000
    const before = pacerGapM(plan, now, 100)
    plan = rebasePacer(plan, 100, 0)
    expect(pacerGapM(plan, now, 0)).toBeCloseTo(before)
  })
})

describe('status hysteresis', () => {
  const run = (gaps: number[]) => {
    let s: PacerStatus = 'on'
    return gaps.map((g) => (s = nextPacerStatus(s, g, WARMUP_MS + 1)))
  }
  it('is quiet during the warm-up', () => {
    expect(nextPacerStatus('on', -500, WARMUP_MS - 1)).toBe('warmup')
  })
  it('enters at the thresholds and leaves only inside the exit band', () => {
    expect(run([0, ENTER_M, ENTER_M - 1, EXIT_M + 1, EXIT_M, 0])).toEqual(['on', 'ahead', 'ahead', 'ahead', 'on', 'on'])
    expect(run([-ENTER_M, -ENTER_M + 1, -EXIT_M - 1, -EXIT_M + 1])).toEqual(['behind', 'behind', 'behind', 'on'])
  })
  it('property: gap noise inside the hysteresis band never flips ahead and behind quickly', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -(ENTER_M - 1), max: ENTER_M - 1, noNaN: true }), { minLength: 5, maxLength: 200 }), (gaps) => {
        // Starting on pace, noise below the enter threshold never leaves "on".
        expect(new Set(run(gaps))).toEqual(new Set(['on']))
      }),
    )
  })
  it('property: it changes state at most once per crossing of a threshold', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -80, max: 80, noNaN: true }), { minLength: 2, maxLength: 200 }), (gaps) => {
        const out = run(gaps)
        for (let i = 1; i < out.length; i++) {
          // ahead and behind are never adjacent without passing through the band.
          const pair = [out[i - 1], out[i]]
          if (pair.includes('ahead') && pair.includes('behind')) expect(Math.abs(gaps[i]! - gaps[i - 1]!)).toBeGreaterThanOrEqual(2 * ENTER_M)
        }
      }),
    )
  })
})

describe('ghost placement on the route', () => {
  const line = new RouteLine([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 10, y: 30 }], 600)
  const distToLine = (p: { x: number; y: number }) => {
    let best = Infinity
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1]!
      const b = line.pts[i]!
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
      const k = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2))
      best = Math.min(best, Math.hypot(p.x - (a.x + k * (b.x - a.x)), p.y - (a.y + k * (b.y - a.y))))
    }
    return best
  }
  it('property: the ghost is always on the route, ahead of the pace point, never back and never past the finish', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 60_000 }), { minLength: 1, maxLength: 60 }), fc.integer({ min: 1, max: 20 }), (dts, rate) => {
        const plan = startPacer(0, pace, { rate })
        let t = 0
        let last = 0
        for (const dt of dts) {
          t += dt
          const along = ghostAlongM(plan, t, line.totalM)
          expect(along).toBeGreaterThanOrEqual(last)
          expect(along).toBeLessThanOrEqual(line.totalM)
          expect(along).toBeGreaterThanOrEqual(pacerAlongM(plan, t, line.totalM))
          expect(distToLine(line.pointAt(along))).toBeLessThan(1e-6)
          last = along
        }
      }),
    )
  })
  it('stands a short lead ahead of the start, so it shows next to the hero at once', () => {
    expect(ghostAlongM(startPacer(0, pace), 0, line.totalM)).toBe(GHOST_LEAD_M)
  })
})

describe('ghost art', () => {
  it('has valid 16×16 frames in our own colours', () => {
    for (const f of GHOST_FRAMES) expect(spriteIsValid(f)).toBe(true)
    expect(GHOST_FRAMES).toHaveLength(4)
  })
  it('picks frames by pose, and the hem wave alternates', () => {
    expect(ghostSprite('happy')).toBe(GHOST_HAPPY)
    expect(ghostSprite('boo')).toBe(GHOST_BOO)
    expect(ghostSprite('float', 0)).toBe(GHOST_FLOAT[0])
    expect(ghostSprite('float', 1)).toBe(GHOST_FLOAT[1])
    expect(ghostPhase(0)).not.toBe(ghostPhase(320))
  })
  it('does not bob when motion is reduced', () => {
    for (let t = 0; t < 2000; t += 50) expect(ghostBob(t, true)).toBe(0)
  })
})
