import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { nextZoom, ZOOM_LEVELS } from './camera.ts'
import { DOUBLE_TAP_MS, glideStep, GLIDE_START, GLIDE_STOP, pinchLevel, speed, TapPairer, VelocityTracker, WheelAccumulator } from './gestures.ts'

describe('wheel accumulator (B1)', () => {
  it('turns a mouse notch into one step and ignores horizontal scroll', () => {
    const w = new WheelAccumulator()
    expect(w.push(-100, 0, 0)).toBe(1)
    expect(w.push(100, 0, 1000)).toBe(-1)
    expect(w.push(0, 0, 2000)).toBe(0)
  })
  it('needs a whole notch of small trackpad deltas, not one step per event', () => {
    const w = new WheelAccumulator()
    let steps = 0
    for (let i = 0; i < 30; i++) steps += w.push(-3, 0, i * 8)
    expect(steps).toBe(0) // 90 px so far
    steps += w.push(-12, 0, 250)
    expect(steps).toBe(1)
  })
  it('counts Firefox lines (3 lines is a notch) and forgets old partial travel', () => {
    const w = new WheelAccumulator()
    expect(w.push(-3, 1, 0)).toBe(1)
    expect(w.push(-60, 0, 10_000)).toBe(0)
    expect(w.push(-60, 0, 20_000)).toBe(0) // the first 60 px were forgotten
    expect(w.push(60, 0, 20_010)).toBe(0) // turning round starts over
  })
  it('property: every step is paid for by 100 px of travel in its own direction', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -400, max: 400 }), { maxLength: 60 }), (deltas) => {
        const w = new WheelAccumulator()
        let steps = 0
        let travel = 0
        deltas.forEach((d, i) => {
          const n = w.push(d, 0, i * 10)
          if (n !== 0) expect(Math.sign(n)).toBe(-Math.sign(d))
          steps += Math.abs(n)
          travel += Math.abs(d)
        })
        expect(steps).toBeLessThanOrEqual(travel / 100 + 1e-9)
      }),
      { seed: 20261204 },
    )
  })
})

describe('pinch level (B2)', () => {
  it('is stable at a target between two levels (no flicker at ratio 1.41 from 8 to 16)', () => {
    const target = 8 * 1.41
    let z = 8
    const seen: number[] = []
    for (let i = 0; i < 10; i++) {
      z = pinchLevel(target, z)
      seen.push(z)
    }
    expect(new Set(seen).size).toBe(1)
  })
  it('property: idempotent, on the ladder, monotone in the target, and never skips hysteresis', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.3, max: 80, noNaN: true }), fc.double({ min: 0.3, max: 80, noNaN: true }), fc.constantFrom(...ZOOM_LEVELS), (t1, t2, start) => {
        const a = pinchLevel(t1, start)
        expect(ZOOM_LEVELS).toContain(a)
        expect(pinchLevel(t1, a)).toBe(a)
        const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1]
        expect(pinchLevel(lo, start)).toBeLessThanOrEqual(pinchLevel(hi, start))
        // Within 8 % of the level in force, nothing changes.
        expect(pinchLevel(start * 1.05, start)).toBe(start === 48 ? 48 : start)
      }),
      { seed: 20261204 },
    )
  })
  it('walks several levels for a big spread', () => {
    expect(pinchLevel(48, 8)).toBe(48)
    expect(pinchLevel(0.5, 16)).toBe(0.5)
  })
})

describe('velocity and glide (inertia)', () => {
  it('measures a steady drag and reports zero after a rest', () => {
    const v = new VelocityTracker()
    for (let i = 0; i <= 5; i++) v.add(i * 10, 0, i * 16)
    expect(v.velocity(80).vx).toBeCloseTo(10 / 16, 5)
    expect(v.velocity(80 + 200)).toEqual({ vx: 0, vy: 0 })
  })
  it('glides a finite distance of v·τ and slows to a stop', () => {
    let v = { vx: 1, vy: 0 }
    let total = 0
    let t = 0
    while (speed(v) > GLIDE_STOP && t < 20_000) {
      const s = glideStep(v, 16)
      total += s.dx
      v = s.next
      t += 16
    }
    expect(total).toBeGreaterThan(200)
    expect(total).toBeLessThan(250) // the integral is 250 px for 1 px/ms
    expect(t).toBeLessThan(1500)
    expect(GLIDE_START).toBeGreaterThan(GLIDE_STOP)
  })
  it('property: step size does not change the distance (exact integral)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 3, noNaN: true }), fc.integer({ min: 1, max: 40 }), (vx, n) => {
        const dt = 480
        let one = glideStep({ vx, vy: 0 }, dt).dx
        let split = 0
        let v = { vx, vy: 0 }
        for (let i = 0; i < n; i++) {
          const s = glideStep(v, dt / n)
          split += s.dx
          v = s.next
        }
        expect(split).toBeCloseTo(one, 6)
        one = 0
      }),
      { seed: 20261204 },
    )
  })
})

describe('double tap', () => {
  it('pairs two near, quick taps once', () => {
    const t = new TapPairer()
    expect(t.tap(100, 100, 0)).toBe('single')
    expect(t.tap(110, 105, DOUBLE_TAP_MS - 1)).toBe('double')
    expect(t.tap(110, 105, DOUBLE_TAP_MS)).toBe('single') // the pair is used up
  })
  it('does not pair slow or distant taps', () => {
    const t = new TapPairer()
    t.tap(0, 0, 0)
    expect(t.tap(0, 0, DOUBLE_TAP_MS + 1)).toBe('single')
    expect(t.tap(100, 0, DOUBLE_TAP_MS + 50)).toBe('single')
  })
})

describe('zoom ladder steps', () => {
  it('property: next level is strictly above or below, or stays at the end', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 100, noNaN: true }), (z) => {
        const up = nextZoom(z, 1)
        const down = nextZoom(z, -1)
        expect(up > z || up === 48).toBe(true)
        expect(down < z || down === 0.5).toBe(true)
      }),
      { seed: 20261204 },
    )
  })
})
