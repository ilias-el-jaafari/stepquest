import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { COLORS, createShow, MAX_PARTICLES, SHOW_MS, showIsOver, showPixels, stepShow } from './celebration.ts'

const run = (seed: number, calm: boolean, ms: number) => {
  const show = createShow(seed, 80, 140, calm)
  stepShow(show, ms)
  return show
}

describe('celebration', () => {
  it('is deterministic for a seed', () => {
    expect(showPixels(run(5, false, 2000))).toEqual(showPixels(run(5, false, 2000)))
  })
  it('fires bursts of sparks in the lively show and none in the calm one', () => {
    expect(run(1, false, 1500).particles.some((p) => p.kind === 'spark')).toBe(true)
    const calm = run(1, true, 3000)
    expect(calm.particles.every((p) => p.kind === 'star')).toBe(true)
    expect(calm.particles.length).toBeLessThan(40)
  })
  it('empties the sky after the show', () => {
    const show = run(3, false, SHOW_MS + 6000)
    expect(showIsOver(show)).toBe(true)
  })
  it('uses only palette colours', () => {
    for (const p of showPixels(run(2, false, 1800))) expect(COLORS as readonly string[]).toContain(p.color)
  })
  it('never exceeds the particle cap and keeps finite coordinates', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.boolean(), fc.array(fc.integer({ min: 0, max: 700 }), { maxLength: 40 }), (seed, calm, steps) => {
        const show = createShow(seed, 60, 100, calm)
        for (const d of steps) {
          stepShow(show, d)
          expect(show.particles.length).toBeLessThanOrEqual(MAX_PARTICLES)
          for (const p of show.particles) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        }
      }),
    )
  })
  it('ignores bad time steps', () => {
    const show = createShow(1, 50, 50, false)
    stepShow(show, Number.NaN)
    stepShow(show, -5)
    expect(show.t).toBe(0)
  })
})
