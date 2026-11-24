import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bboxAround, destination, EARTH_RADIUS_M, haversine, LocalProjection } from './geo.ts'
import { clampStride, MAX_STEPS, MAX_STRIDE_M, metresToSteps, MIN_STEPS, MIN_STRIDE_M, roundStride, stepsToMetres, strideFromHeightCm } from './steps.ts'

/** Review (Nov 2026): geodesy edge cases and the steps ↔ metres contract. */

describe('geodesy (review)', () => {
  it('B10: destination keeps the longitude in [-180, 180]', () => {
    const east = destination({ lat: 0, lon: 179.9999 }, 90, 1000)
    expect(east.lon).toBeLessThanOrEqual(180)
    expect(east.lon).toBeGreaterThanOrEqual(-180)
    expect(east.lon).toBeLessThan(-179)
    const west = destination({ lat: 10, lon: -179.9999 }, 270, 1000)
    expect(west.lon).toBeGreaterThan(179)
  })

  it('B11: bboxAround uses the same metres per degree as the projection', () => {
    const c = { lat: 0, lon: 0 }
    const box = bboxAround(c, 1000)
    expect(haversine(c, { lat: box.north, lon: 0 })).toBeCloseTo(1000, 3)
    expect(haversine(c, { lat: 0, lon: box.east })).toBeCloseTo(1000, 3)
    expect(EARTH_RADIUS_M).toBeGreaterThan(0)
  })

  it('B12: a box near a pole stays finite and inside the valid range', () => {
    for (const lat of [89.9999, -89.9999, 90, -90]) {
      const b = bboxAround({ lat, lon: 10 }, 5000)
      for (const v of [b.south, b.north, b.west, b.east]) expect(Number.isFinite(v)).toBe(true)
      expect(b.north).toBeLessThanOrEqual(90)
      expect(b.south).toBeGreaterThanOrEqual(-90)
      expect(b.west).toBeGreaterThanOrEqual(-180)
      expect(b.east).toBeLessThanOrEqual(180)
    }
  })

  it('B13: the projection takes the short way across the antimeridian and survives a pole origin', () => {
    const p = new LocalProjection({ lat: 0, lon: 179.999 })
    const { x } = p.toXY({ lat: 0, lon: -179.999 })
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(500)
    const pole = new LocalProjection({ lat: 90, lon: 0 })
    const back = pole.toLatLon(10, 10)
    expect(Number.isFinite(back.lat) && Number.isFinite(back.lon)).toBe(true)
  })

  it('projection round trip is exact to well under a millimetre for walk-sized offsets', () => {
    fc.assert(
      fc.property(fc.double({ min: -80, max: 80, noNaN: true }), fc.double({ min: -179, max: 179, noNaN: true }), fc.double({ min: -4000, max: 4000, noNaN: true }), fc.double({ min: -4000, max: 4000, noNaN: true }), (lat, lon, x, y) => {
        const proj = new LocalProjection({ lat, lon })
        const p = proj.toLatLon(x, y)
        const q = proj.toXY(p)
        expect(Math.abs(q.x - x)).toBeLessThan(1e-3)
        expect(Math.abs(q.y - y)).toBeLessThan(1e-3)
      }),
    )
  })

  it('projection distance matches haversine within 0.5 % over 4 km (up to latitude 60)', () => {
    fc.assert(
      fc.property(fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -170, max: 170, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 100, max: 4000, noNaN: true }), (lat, lon, bearing, d) => {
        const o = { lat, lon }
        const proj = new LocalProjection(o)
        const p = proj.toXY(destination(o, bearing, d))
        expect(Math.abs(Math.hypot(p.x, p.y) - d) / d).toBeLessThan(0.005)
      }),
    )
  })
})

describe('steps and stride (review)', () => {
  it('B14: roundStride gives whole centimetres inside the bounds', () => {
    expect(roundStride(0.7549)).toBe(0.75)
    expect(roundStride(0.755)).toBe(0.76)
    expect(roundStride(0.1)).toBe(MIN_STRIDE_M)
    expect(roundStride(9)).toBe(MAX_STRIDE_M)
    expect(roundStride(Number.NaN)).toBe(0.75)
    expect(roundStride(Number.POSITIVE_INFINITY)).toBe(0.75)
  })

  it('steps → metres → steps returns the same whole number of steps for every goal and stride', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_STEPS, max: MAX_STEPS }), fc.integer({ min: 40, max: 120 }), (steps, cm) => {
        const stride = cm / 100
        expect(metresToSteps(stepsToMetres(steps, stride), stride)).toBe(steps)
      }),
    )
  })

  it('metres → steps → metres is within half a stride', () => {
    fc.assert(
      fc.property(fc.double({ min: 50, max: 80_000, noNaN: true }), fc.integer({ min: 40, max: 120 }), (m, cm) => {
        const stride = cm / 100
        expect(Math.abs(stepsToMetres(metresToSteps(m, stride), stride) - m)).toBeLessThanOrEqual(stride / 2 + 1e-9)
      }),
    )
  })

  it('stride is always in range, and monotone in height', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (v) => {
        const s = clampStride(v)
        expect(s).toBeGreaterThanOrEqual(MIN_STRIDE_M)
        expect(s).toBeLessThanOrEqual(MAX_STRIDE_M)
        const h = strideFromHeightCm(v)
        expect(h).toBeGreaterThanOrEqual(MIN_STRIDE_M)
        expect(h).toBeLessThanOrEqual(MAX_STRIDE_M)
      }),
    )
    let prev = 0
    for (let cm = 100; cm <= 230; cm++) {
      const s = strideFromHeightCm(cm)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })
})
