import { describe, expect, it } from 'vitest'
import { isDark, isNightWalk, sunAltitude, sunTimes } from './sun.ts'

const VALENCIA = { lat: 39.4935, lon: -0.392 }
const minutes = (ms: number) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes()

describe('sun', () => {
  it('matches published sunrise and sunset in Valencia within a few minutes', () => {
    // 22 Nov 2026: sunrise ≈ 07:53, sunset ≈ 17:41 Madrid time (UTC+1).
    const t = sunTimes(Date.UTC(2026, 10, 22, 12), VALENCIA)!
    expect(Math.abs(minutes(t.sunrise) - (6 * 60 + 53))).toBeLessThanOrEqual(4)
    expect(Math.abs(minutes(t.sunset) - (16 * 60 + 41))).toBeLessThanOrEqual(4)
    // 21 Jun 2026: sunset ≈ 21:30 Madrid time (UTC+2).
    const s = sunTimes(Date.UTC(2026, 5, 21, 12), VALENCIA)!
    expect(Math.abs(minutes(s.sunset) - (19 * 60 + 30))).toBeLessThanOrEqual(5)
  })
  it('knows day from night', () => {
    expect(isDark(Date.UTC(2026, 10, 22, 12), VALENCIA)).toBe(false)
    expect(isDark(Date.UTC(2026, 10, 22, 20), VALENCIA)).toBe(true)
    expect(sunAltitude(Date.UTC(2026, 5, 21, 12), VALENCIA)).toBeGreaterThan(60)
  })
  it('night starts exactly at sunset and ends at sunrise', () => {
    const t = sunTimes(Date.UTC(2026, 10, 22, 12), VALENCIA)!
    const minute = 60_000
    expect(isDark(t.sunset - minute, VALENCIA)).toBe(false)
    expect(isDark(t.sunset + minute, VALENCIA)).toBe(true)
    expect(isDark(t.sunrise - minute, VALENCIA)).toBe(true)
    expect(isDark(t.sunrise + minute, VALENCIA)).toBe(false)
    // Civil twilight is not used: half an hour after sunset is already night.
    expect(isDark(t.sunset + 30 * minute, VALENCIA)).toBe(true)
  })
  it('has no sunset during polar night or day', () => {
    expect(sunTimes(Date.UTC(2026, 5, 21, 12), { lat: 80, lon: 0 })).toBeUndefined()
    expect(sunTimes(Date.UTC(2026, 11, 21, 12), { lat: 80, lon: 0 })).toBeUndefined()
  })
})

describe('sun review (safety-night 68.x)', () => {
  const DAY = 86_400_000
  it('sunTimes follows the local solar day, not the UTC day, far from Greenwich', () => {
    for (const lon of [-170, -120, 150, 175]) {
      const p = { lat: 40, lon }
      const ms = Date.UTC(2026, 2, 10, 3) // 03:00 UTC is the previous evening or the next morning locally
      const t = sunTimes(ms, p)!
      // The returned day is the one around ms: sunset is less than 12 h after it and sunrise less than 12 h before.
      expect(t.sunset - ms).toBeGreaterThan(-12 * 3_600_000)
      expect(t.sunset - ms).toBeLessThan(12 * 3_600_000)
      expect(isDark(ms, p)).toBe(ms < t.sunrise || ms > t.sunset)
    }
  })
  it('isDark agrees with sunrise and sunset all over the world (away from the exact minute)', () => {
    for (const lat of [-55, -35, 0, 20, 39.5, 52]) {
      for (const lon of [-175, -75, -0.4, 60, 140, 179]) {
        for (let d = 0; d < 360; d += 37) {
          const base = Date.UTC(2026, 0, 1) + d * DAY
          for (let h = 0; h < 24; h += 1.7) {
            const ms = base + h * 3_600_000
            const t = sunTimes(ms, { lat, lon })
            if (!t) continue
            const edge = Math.min(Math.abs(ms - t.sunrise), Math.abs(ms - t.sunset))
            if (edge < 3 * 60_000) continue
            expect(isDark(ms, { lat, lon }), `lat ${lat} lon ${lon} ms ${ms}`).toBe(ms < t.sunrise || ms > t.sunset)
          }
        }
      }
    }
  })
  it('sun altitude is continuous (no jump at UTC midnight or at the year turn) and finite', () => {
    for (const p of [VALENCIA, { lat: 69.6, lon: 18.9 }, { lat: -77, lon: 166 }, { lat: 0, lon: 179.9 }]) {
      let prev = sunAltitude(Date.UTC(2025, 11, 30), p)
      for (let ms = Date.UTC(2025, 11, 30) + 60_000; ms < Date.UTC(2026, 0, 3); ms += 60_000) {
        const a = sunAltitude(ms, p)
        expect(Number.isFinite(a)).toBe(true)
        expect(Math.abs(a - prev)).toBeLessThan(0.5) // the sun moves at most 0.25° per minute
        prev = a
      }
    }
  })
  it('polar day is never dark and polar night always is', () => {
    const north = { lat: 80, lon: 15 }
    for (let h = 0; h < 24; h++) {
      expect(isDark(Date.UTC(2026, 5, 21, h), north)).toBe(false)
      expect(isDark(Date.UTC(2026, 11, 21, h), north)).toBe(true)
    }
    expect(sunTimes(Date.UTC(2026, 5, 21), north)).toBeUndefined()
  })
  it('has sensible times just outside the polar circle (Tromsø in midsummer has none, in March it does)', () => {
    const tromso = { lat: 69.65, lon: 18.96 }
    expect(sunTimes(Date.UTC(2026, 5, 21, 12), tromso)).toBeUndefined()
    const t = sunTimes(Date.UTC(2026, 2, 20, 12), tromso)!
    expect(t.sunset - t.sunrise).toBeGreaterThan(11 * 3_600_000)
    expect(t.sunset - t.sunrise).toBeLessThan(13 * 3_600_000)
  })
  it('sunset is the same across a DST change: the maths is UTC, so only the clock label moves', () => {
    const before = sunTimes(Date.UTC(2026, 2, 28, 12), VALENCIA)!
    const after = sunTimes(Date.UTC(2026, 2, 29, 12), VALENCIA)! // Madrid clocks go forward on 29 Mar 2026
    expect(Math.abs(after.sunset - before.sunset - DAY)).toBeLessThan(3 * 60_000)
  })
  it('does not produce NaN for invalid input', () => {
    expect(isDark(Number.NaN, VALENCIA)).toBe(false)
    expect(sunTimes(Number.NaN, VALENCIA)).toBeUndefined()
  })
})

describe('isNightWalk (decision S5)', () => {
  const t = sunTimes(Date.UTC(2026, 10, 22, 12), VALENCIA)!
  const H = 3_600_000
  it('a walk that starts before sunset and ends after it is a night walk from the start', () => {
    expect(isNightWalk(t.sunset - 0.5 * H, 2 * H, VALENCIA)).toBe(true)
  })
  it('a walk that ends before sunset is a day walk', () => {
    expect(isNightWalk(t.sunset - 3 * H, 1 * H, VALENCIA)).toBe(false)
  })
  it('a walk that starts in the dark is a night walk even when it ends after sunrise', () => {
    expect(isNightWalk(t.sunrise - 0.5 * H, 2 * H, VALENCIA)).toBe(true)
  })
  it('ignores a negative or NaN duration', () => {
    expect(isNightWalk(t.sunset - 3 * H, -5 * H, VALENCIA)).toBe(false)
    expect(isNightWalk(t.sunset - 3 * H, Number.NaN, VALENCIA)).toBe(false)
  })
})
