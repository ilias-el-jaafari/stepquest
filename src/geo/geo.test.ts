import { describe, expect, it } from 'vitest'
import { bboxAround, bboxContains, destination, haversine, LocalProjection } from './geo.ts'

const benicalap = { lat: 39.4935, lon: -0.392 }

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(benicalap, benicalap)).toBe(0)
  })
  it('measures one degree of latitude as about 111 km', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1)
  })
  it('is symmetric', () => {
    const b = { lat: 39.5, lon: -0.38 }
    expect(haversine(benicalap, b)).toBeCloseTo(haversine(b, benicalap), 6)
  })
})

describe('destination', () => {
  it('round-trips with haversine', () => {
    for (const bearing of [0, 45, 90, 180, 270, 333]) {
      const p = destination(benicalap, bearing, 1234)
      expect(haversine(benicalap, p)).toBeCloseTo(1234, 3)
    }
  })
})

describe('LocalProjection', () => {
  it('maps the origin to (0,0) and round-trips', () => {
    const proj = new LocalProjection(benicalap)
    expect(proj.toXY(benicalap)).toEqual({ x: 0, y: 0 })
    const p = { lat: 39.5, lon: -0.38 }
    const { x, y } = proj.toXY(p)
    const back = proj.toLatLon(x, y)
    expect(back.lat).toBeCloseTo(p.lat, 9)
    expect(back.lon).toBeCloseTo(p.lon, 9)
  })
  it('agrees with haversine to within 0.1% over 2 km', () => {
    const proj = new LocalProjection(benicalap)
    const p = destination(benicalap, 60, 2000)
    const { x, y } = proj.toXY(p)
    expect(Math.hypot(x, y)).toBeGreaterThan(1998)
    expect(Math.hypot(x, y)).toBeLessThan(2002)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeLessThan(0) // north is up, so y is negative
  })
})

describe('bbox helpers', () => {
  it('builds a box that contains its centre and not far points', () => {
    const box = bboxAround(benicalap, 500)
    expect(bboxContains(box, benicalap)).toBe(true)
    expect(bboxContains(box, destination(benicalap, 0, 600))).toBe(false)
    expect(bboxContains(box, destination(benicalap, 90, 450))).toBe(true)
  })
})
