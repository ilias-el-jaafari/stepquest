import { describe, expect, it } from 'vitest'
import { isDark, sunTimes } from '../geo/sun.ts'
import { atLocalMinutes, lightingAt, parseTimeParam, TINT_KEYS } from './daylight.ts'

const VALENCIA = { lat: 39.4935, lon: -0.392 }
const MIN = 60_000

describe('day-cycle lighting', () => {
  it('is untouched at noon and dark at midnight', () => {
    const noon = lightingAt(Date.UTC(2026, 5, 21, 10), VALENCIA)
    expect(noon.phase).toBe('day')
    expect(noon.tint).toEqual([255, 255, 255])
    expect(noon.lamps).toBe(0)
    const night = lightingAt(Date.UTC(2026, 5, 21, 23), VALENCIA)
    expect(night.phase).toBe('night')
    expect(night.lamps).toBe(1)
    expect(night.windows).toBe(1)
    expect(night.darkness).toBeGreaterThan(0.5)
  })
  it('goes golden before sunset and dusk exactly when safe routing says night', () => {
    const t = sunTimes(Date.UTC(2026, 10, 22, 12), VALENCIA)!
    expect(lightingAt(t.sunset - 30 * MIN, VALENCIA).phase).toBe('golden')
    expect(lightingAt(t.sunset - 2 * MIN, VALENCIA).phase).toBe('golden')
    expect(lightingAt(t.sunset + 2 * MIN, VALENCIA).phase).toBe('dusk')
    expect(lightingAt(t.sunset + 90 * MIN, VALENCIA).phase).toBe('night')
    expect(lightingAt(t.sunrise + 20 * MIN, VALENCIA).phase).toBe('golden')
    for (let ms = t.sunset - 3 * 3_600_000; ms < t.sunset + 3 * 3_600_000; ms += 5 * MIN) {
      const dark = ['dusk', 'night'].includes(lightingAt(ms, VALENCIA).phase)
      expect(dark).toBe(isDark(ms, VALENCIA))
    }
  })
  it('keeps a warm golden tint (more red than blue) in the hour before sunset and blue-purple after', () => {
    const t = sunTimes(Date.UTC(2026, 5, 21, 12), VALENCIA)!
    const golden = lightingAt(t.sunset - 30 * MIN, VALENCIA).tint
    expect(golden[0]).toBeGreaterThan(golden[2] + 40)
    const dusk = lightingAt(t.sunset + 45 * MIN, VALENCIA).tint
    expect(dusk[2]).toBeGreaterThanOrEqual(dusk[1])
    expect(dusk[0]).toBeLessThan(golden[0])
  })
  it('has keyframes in descending altitude order', () => {
    for (let i = 1; i < TINT_KEYS.length; i++) expect(TINT_KEYS[i]![0]).toBeLessThan(TINT_KEYS[i - 1]![0])
  })
})

describe('lighting preview clock', () => {
  it('parses ?time= values', () => {
    expect(parseTimeParam('?time=19:45')).toBe(19 * 60 + 45)
    expect(parseTimeParam('?a=1&time=7')).toBe(7 * 60)
    expect(parseTimeParam('?time=0630')).toBe(6 * 60 + 30)
    expect(parseTimeParam('?time=19.05')).toBe(19 * 60 + 5)
    expect(parseTimeParam('?time=24:00')).toBeUndefined()
    expect(parseTimeParam('?time=12:60')).toBeUndefined()
    expect(parseTimeParam('?time=abc')).toBeUndefined()
    expect(parseTimeParam('')).toBeUndefined()
  })
  it('puts the moment on the same local day', () => {
    const now = new Date(2026, 5, 21, 10, 11, 12).getTime()
    const d = new Date(atLocalMinutes(now, 19 * 60 + 45))
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2026, 5, 21, 19, 45, 0])
  })
})
