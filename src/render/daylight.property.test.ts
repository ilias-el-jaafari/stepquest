import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sunTimes } from '../geo/sun.ts'
import { lightingAt, lightingFromAltitude } from './daylight.ts'

const SEED = 20261204
const MIN = 60_000

const placeArb = fc.record({ lat: fc.double({ min: -55, max: 55, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }) })
const dayArb = fc.integer({ min: Date.UTC(2026, 0, 1, 12), max: Date.UTC(2026, 11, 31, 12) })

describe('lighting properties', () => {
  it('P-L1 stays within bounds for any altitude, time and place', () => {
    fc.assert(
      fc.property(fc.double({ min: -90, max: 90, noNaN: true }), (alt) => {
        const l = lightingFromAltitude(alt)
        expect(l.darkness).toBeGreaterThanOrEqual(0)
        expect(l.darkness).toBeLessThanOrEqual(1)
        for (const v of [l.lamps, l.windows]) expect(v >= 0 && v <= 1).toBe(true)
        for (const c of l.tint) expect(Number.isInteger(c) && c >= 0 && c <= 255).toBe(true)
      }),
      { seed: SEED },
    )
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), placeArb, (ms, p) => {
        const l = lightingAt(ms, p)
        expect(Number.isFinite(l.darkness) && l.darkness >= 0 && l.darkness <= 1).toBe(true)
      }),
      { seed: SEED },
    )
  })

  it('P-L2 darkness, lamps and windows never decrease as the sun sinks (altitude)', () => {
    fc.assert(
      fc.property(fc.double({ min: -30, max: 40, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (alt, d) => {
        const hi = lightingFromAltitude(alt + d)
        const lo = lightingFromAltitude(alt)
        expect(lo.darkness).toBeGreaterThanOrEqual(hi.darkness - 1e-12)
        expect(lo.lamps).toBeGreaterThanOrEqual(hi.lamps - 1e-12)
        expect(lo.windows).toBeGreaterThanOrEqual(hi.windows - 1e-12)
      }),
      { seed: SEED },
    )
  })

  it('P-L3 from afternoon into night, darkness is monotonic in time and continuous minute to minute', () => {
    fc.assert(
      fc.property(placeArb, dayArb, (p, day) => {
        const t = sunTimes(day, p)
        if (!t) return
        let prev = lightingAt(t.sunset - 3 * 3_600_000, p).darkness
        for (let ms = t.sunset - 3 * 3_600_000 + MIN; ms <= t.sunset + 3 * 3_600_000; ms += MIN) {
          const d = lightingAt(ms, p).darkness
          expect(d).toBeGreaterThanOrEqual(prev - 1e-9)
          expect(d - prev).toBeLessThan(0.02) // no jumps: well under 2 % of the range per minute
          prev = d
        }
      }),
      { seed: SEED, numRuns: 40 },
    )
  })

  it('P-L4 from before sunrise into morning, darkness never increases', () => {
    fc.assert(
      fc.property(placeArb, dayArb, (p, day) => {
        const t = sunTimes(day, p)
        if (!t) return
        let prev = lightingAt(t.sunrise - 3 * 3_600_000, p).darkness
        for (let ms = t.sunrise - 3 * 3_600_000 + MIN; ms <= t.sunrise + 3 * 3_600_000; ms += MIN) {
          const d = lightingAt(ms, p).darkness
          expect(d).toBeLessThanOrEqual(prev + 1e-9)
          prev = d
        }
      }),
      { seed: SEED, numRuns: 40 },
    )
  })
})
