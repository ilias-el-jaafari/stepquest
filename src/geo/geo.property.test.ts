import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bboxAround, haversine, isValidBBox, LocalProjection } from './geo.ts'

const SEED = 20261204

describe('geo properties (task 66.2)', () => {
  it('P-G1: toLatLon(toXY(p)) returns p, for origins and points anywhere including across the antimeridian', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -0.05, max: 0.05, noNaN: true }),
        fc.double({ min: -0.05, max: 0.05, noNaN: true }),
        (lat, lon, dLat, dLon) => {
          const proj = new LocalProjection({ lat, lon })
          const wrapped = ((((lon + dLon + 180) % 360) + 360) % 360) - 180
          const p = { lat: Math.max(-89, Math.min(89, lat + dLat)), lon: wrapped }
          const { x, y } = proj.toXY(p)
          const back = proj.toLatLon(x, y)
          expect(back.lat).toBeCloseTo(p.lat, 8)
          const dl = Math.abs(((back.lon - p.lon + 540) % 360) - 180)
          expect(dl).toBeLessThan(1e-8)
        },
      ),
      { seed: SEED, numRuns: 400 },
    )
  })

  it('P-G2: within 6 km the projected distance is within 0.5 % of haversine at any latitude up to 70°', () => {
    fc.assert(
      fc.property(fc.double({ min: -70, max: 70, noNaN: true }), fc.double({ min: -179, max: 179, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 50, max: 6000, noNaN: true }), (lat, lon, bearing, dist) => {
        const origin = { lat, lon }
        const proj = new LocalProjection(origin)
        const brg = (bearing * Math.PI) / 180
        const dLat = (dist * Math.cos(brg)) / 111_195
        const dLon = (dist * Math.sin(brg)) / (111_195 * Math.cos((lat * Math.PI) / 180))
        const p = { lat: lat + dLat, lon: lon + dLon }
        const { x, y } = proj.toXY(p)
        expect(Math.abs(Math.hypot(x, y) / haversine(origin, p) - 1)).toBeLessThan(0.005)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-G3: a box around any point and radius is valid and contains the point', () => {
    fc.assert(
      fc.property(fc.double({ min: -90, max: 90, noNaN: true }), fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: 10, max: 5000, noNaN: true }), (lat, lon, r) => {
        const b = bboxAround({ lat, lon }, r)
        expect(isValidBBox(b)).toBe(true)
        expect(b.south <= lat && lat <= b.north && b.west <= lon && lon <= b.east).toBe(true)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })
})
