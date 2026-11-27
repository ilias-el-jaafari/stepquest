import { describe, expect, it } from 'vitest'
import { destination, type LatLon } from '../geo/geo.ts'
import { FOCUS_RADIUS_M, MAX_VIEW_FOCUS } from './config.ts'
import { LodFocus } from './focus.ts'

const HERO: LatLon = { lat: 39.4935, lon: -0.392 }
const R = 10_000

describe('focus points (requirement 26.3)', () => {
  it('the finish is kept first, set and cleared', () => {
    const f = new LodFocus()
    const end = destination(HERO, 45, 9_000)
    expect(f.pin(end)).toBe(true)
    expect(f.pin({ ...end })).toBe(false)
    expect(f.points()).toEqual([end])
    expect(f.pin(undefined)).toBe(true)
    expect(f.points()).toEqual([])
  })

  it('a view inside the hero\'s rings is no focus; one beyond them is, once', () => {
    const f = new LodFocus()
    expect(f.view(destination(HERO, 0, 5_000), HERO, R)).toBe(false)
    const far = destination(HERO, 90, 11_000)
    expect(f.view(far, HERO, R)).toBe(true)
    expect(f.view(destination(far, 0, FOCUS_RADIUS_M / 4), HERO, R)).toBe(false)
    expect(f.points()).toEqual([far])
  })

  it('keeps the newest views only, after the finish', () => {
    const f = new LodFocus()
    const end = destination(HERO, 200, 9_500)
    f.pin(end)
    const views = [1, 2, 3, 4].map((k) => destination(HERO, 90, 10_500 + k * 4_000))
    for (const v of views) f.view(v, HERO, R)
    const pts = f.points()
    expect(pts[0]).toEqual(end)
    expect(pts.length).toBe(1 + MAX_VIEW_FOCUS)
    expect(pts[1]).toEqual(views[3])
    expect(pts[2]).toEqual(views[2])
  })

  it('without a hero every resting view is a focus', () => {
    const f = new LodFocus()
    expect(f.view(HERO, undefined, R)).toBe(true)
  })
})
