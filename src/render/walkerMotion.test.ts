import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TELEPORT_TILES, WalkerMotion } from './walkerMotion.ts'

/**
 * The walker must glide: its shown position is a function of the clock, so a frame (any rate) between two
 * fixes moves it by about speed × frame time, at ×1 (a fix every 2 s) and at ×20 (a fix every 250 ms).
 */
function glide(gapMs: number, speed: number, latencyMs: number, frameMs: number, fromMs = 8000, toMs = 30_000) {
  const m = new WalkerMotion()
  let nextFix = 0
  let n = 0
  let pending: { at: number; x: number } | undefined
  const steps: number[] = []
  let prev: number | undefined
  for (let t = 0; t < toMs; t += frameMs) {
    if (!pending && nextFix <= t) {
      pending = { at: nextFix + Math.abs(Math.sin(n * 7.3)) * latencyMs, x: speed * nextFix }
      nextFix += gapMs
      n++
    }
    if (pending && pending.at <= t) {
      m.moveTo({ x: pending.x, y: 0 }, n > 1 ? { x: pending.x - speed * gapMs, y: 0 } : undefined, t, false)
      pending = undefined
    }
    const p = m.position(t)!
    if (prev !== undefined && t > fromMs) steps.push((p.x - prev) / (speed * frameMs))
    prev = p.x
  }
  return steps
}

describe('WalkerMotion glide', () => {
  it('property: every frame moves the walker by about speed × frame time, with no stop between fixes and no jump at one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 2500 }), fc.double({ min: 0.0001, max: 0.002, noNaN: true }), fc.integer({ min: 0, max: 40 }), fc.constantFrom(8.33, 16.67, 33.3), (gap, speed, latency, frame) => {
        const steps = glide(gap, speed, latency, frame)
        expect(Math.min(...steps)).toBeGreaterThan(0.55)
        expect(Math.max(...steps)).toBeLessThan(1.6)
      }),
      { seed: 20260412, numRuns: 60 },
    )
  })

  it('shows the same place at the same time whatever the frame rate', () => {
    const run = (frame: number) => {
      const m = new WalkerMotion()
      let out: { x: number } | undefined
      for (let t = 0; t <= 6000; t += frame) {
        if (t % 1000 === 0) m.moveTo({ x: t / 100, y: 0 }, t ? { x: (t - 1000) / 100, y: 0 } : undefined, t, false)
        if (t === 5000) out = m.position(t)
      }
      return out!.x
    }
    expect(run(10)).toBeCloseTo(run(25), 9)
  })

  it('does not stand still between fixes at ×1 (a fix every 2 s), unlike a tween capped at 0.9 s', () => {
    const steps = glide(2000, 0.0004, 20, 16.67)
    const standing = steps.filter((s) => s < 0.2).length
    expect(standing).toBe(0)
  })

  it('settles on the target without a fix, and stops walking', () => {
    const m = new WalkerMotion()
    m.moveTo({ x: 0, y: 0 }, undefined, 0, false)
    m.moveTo({ x: 2, y: 0 }, { x: 0, y: 0 }, 1000, false)
    m.moveTo({ x: 4, y: 0 }, { x: 2, y: 0 }, 2000, false)
    expect(m.isTweening(2100)).toBe(true)
    expect(m.isWalking(2100, false)).toBe(true)
    expect(m.isTweening(30_000)).toBe(false)
    expect(m.isWalking(30_000, false)).toBe(false)
    const end = m.position(30_000)!
    expect(end.x).toBeGreaterThan(4)
    expect(end.x).toBeLessThan(4 + 2 * 1.25 + 1e-6)
  })

  it('places the walker at a jump (reroute or resume) instead of sliding across the map', () => {
    const m = new WalkerMotion()
    m.moveTo({ x: 0, y: 0 }, undefined, 0, false)
    m.moveTo({ x: 1, y: 0 }, { x: 0, y: 0 }, 1000, false)
    m.moveTo({ x: 1 + TELEPORT_TILES * 2, y: 0 }, { x: 1, y: 0 }, 2000, false)
    expect(m.position(2000)).toEqual({ x: 1 + TELEPORT_TILES * 2, y: 0 })
    expect(m.isTweening(2000)).toBe(false)
  })

  it('stays continuous when the heading turns (no jump at the fix)', () => {
    const m = new WalkerMotion()
    m.moveTo({ x: 0, y: 0 }, undefined, 0, false)
    m.moveTo({ x: 1, y: 0 }, { x: 0, y: 0 }, 1000, false)
    m.moveTo({ x: 2, y: 0 }, { x: 1, y: 0 }, 2000, false)
    const before = m.position(2999.9)!
    m.moveTo({ x: 2, y: 1 }, { x: 2, y: 0 }, 3000, false)
    const after = m.position(3000)!
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01)
    expect(m.facing).toBe('down')
  })
})
