import { describe, expect, it } from 'vitest'
import { isDark, sunAltitude, sunTimes } from './sun.ts'

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
  it('has no sunset during polar night or day', () => {
    expect(sunTimes(Date.UTC(2026, 5, 21, 12), { lat: 80, lon: 0 })).toBeUndefined()
    expect(sunTimes(Date.UTC(2026, 11, 21, 12), { lat: 80, lon: 0 })).toBeUndefined()
  })
})
