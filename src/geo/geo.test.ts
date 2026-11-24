import { describe, expect, it } from 'vitest'
import { bboxAreaSphereKm2, bboxAround, bboxContains, destination, haversine, isValidBBox, LocalProjection } from './geo.ts'

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

describe('LocalProjection at other latitudes and the antimeridian (task 66.2)', () => {
  it('stays within 0.3 % of haversine over 6 km at 0°, 40°, 60° and 80° latitude', () => {
    for (const lat of [0, 40, 60, 80]) {
      const origin = { lat, lon: 10 }
      const proj = new LocalProjection(origin)
      for (const bearing of [0, 45, 90, 135, 225, 315]) {
        const p = destination(origin, bearing, 6000)
        const { x, y } = proj.toXY(p)
        expect(Math.abs(Math.hypot(x, y) / haversine(origin, p) - 1)).toBeLessThan(0.003)
      }
    }
  })
  it('measures east-west distances shorter at high latitudes', () => {
    const at = (lat: number) => new LocalProjection({ lat, lon: 0 }).toXY({ lat, lon: 0.01 }).x
    expect(at(60)).toBeCloseTo(at(0) / 2, 0)
  })
  it('keeps points either side of the antimeridian close', () => {
    const proj = new LocalProjection({ lat: -17.7, lon: 179.995 })
    const { x } = proj.toXY({ lat: -17.7, lon: -179.995 })
    expect(Math.abs(x)).toBeLessThan(1100)
    expect(x).toBeGreaterThan(0)
    const back = proj.toLatLon(x, 0)
    expect(back.lon).toBeCloseTo(-179.995, 6)
  })
  it('never divides by zero next to a pole', () => {
    const proj = new LocalProjection({ lat: 90, lon: 0 })
    const { x, y } = proj.toXY({ lat: 89.9, lon: 1 })
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
    const back = proj.toLatLon(x, y)
    expect(Number.isFinite(back.lat) && Number.isFinite(back.lon)).toBe(true)
  })
})

describe('bbox validity (task 66.2)', () => {
  it('clips a box around a point near the antimeridian or a pole to valid coordinates', () => {
    const b = bboxAround({ lat: -17.7, lon: 179.999 }, 1500)
    expect(b.east).toBeLessThanOrEqual(180)
    expect(isValidBBox(b)).toBe(true)
    const pole = bboxAround({ lat: 89.99, lon: 0 }, 3000)
    expect(isValidBBox(pole)).toBe(true)
  })
  it('rejects NaN, inverted and out-of-range boxes', () => {
    const ok = { south: 1, west: 1, north: 2, east: 2 }
    expect(isValidBBox(ok)).toBe(true)
    expect(isValidBBox({ ...ok, north: Number.NaN })).toBe(false)
    expect(isValidBBox({ ...ok, north: 0 })).toBe(false)
    expect(isValidBBox({ ...ok, east: 181 })).toBe(false)
    expect(isValidBBox({ ...ok, south: -91 })).toBe(false)
  })
  it('computes the area of a box exactly (the north edge is wider than the south edge)', () => {
    // 1° × 1° at the equator is about 12 364 km².
    expect(bboxAreaSphereKm2({ south: 0, west: 0, north: 1, east: 1 })).toBeCloseTo(12364, -1)
    expect(bboxAreaSphereKm2({ south: 59, west: 0, north: 60, east: 1 })).toBeCloseTo(12364 * Math.cos(59.5 * (Math.PI / 180)), -1)
  })
})
