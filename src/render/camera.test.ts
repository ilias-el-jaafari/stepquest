import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Camera, nearestZoom, nextZoom, ZOOM_LEVELS } from './camera.ts'
import { backingSize, MAX_PIXELS, MAX_SIDE } from './viewport.ts'

const seed = 20261204
const zoom = fc.constantFrom(...ZOOM_LEVELS)
const size = fc.integer({ min: 120, max: 3000 })

function camera(cols: number, rows: number, w: number, h: number, z: number, x: number, y: number): Camera {
  const c = new Camera(cols, rows)
  c.setSize(w, h)
  c.zoom = z
  c.x = x
  c.y = y
  return c
}

describe('camera (P-C1 to P-C4)', () => {
  it('P-C1 screen ↔ tile round trip is exact to 1e-6 tile at every zoom, anywhere the clamp allows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 50, max: 2400 }), fc.integer({ min: 50, max: 2400 }), size, size, zoom, fc.double({ min: -1, max: 2, noNaN: true }), fc.double({ min: -1, max: 2, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (cols, rows, w, h, z, fx, fy, u, v) => {
        const c = camera(cols, rows, w, h, z, fx * cols, fy * rows)
        c.clamp()
        const t = c.screenToTile(u * w, v * h)
        const s = c.tileToScreen(t.x, t.y)
        expect(Math.abs(s.x - u * w)).toBeLessThan(1e-6 * z + 1e-6)
        expect(Math.abs(s.y - v * h)).toBeLessThan(1e-6 * z + 1e-6)
        const back = c.screenToTile(s.x, s.y)
        expect(Math.abs(back.x - t.x)).toBeLessThan(1e-6)
        expect(Math.abs(back.y - t.y)).toBeLessThan(1e-6)
      }),
      { seed, numRuns: 300 },
    )
  })

  it('P-C2 zooming keeps the tile under the pointer fixed when the clamp does not act', () => {
    fc.assert(
      fc.property(size, size, zoom, zoom, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (w, h, z0, z1, u, v) => {
        const c = camera(100_000, 100_000, w, h, z0, 50_000, 50_000) // far inside: no clamp
        const before = c.screenToTile(u * w, v * h)
        c.zoomTo(z1, u * w, v * h)
        const after = c.screenToTile(u * w, v * h)
        expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6)
        expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6)
      }),
      { seed },
    )
  })

  it('P-C3 the clamp keeps the centre within half a screen of the map and is idempotent', () => {
    fc.assert(
      fc.property(size, size, zoom, fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), (w, h, z, x, y) => {
        const c = camera(600, 640, w, h, z, x, y)
        c.clamp()
        expect(c.x).toBeGreaterThanOrEqual(-w / 2 / z - 1e-9)
        expect(c.x).toBeLessThanOrEqual(600 + w / 2 / z + 1e-9)
        expect(c.y).toBeGreaterThanOrEqual(-h / 2 / z - 1e-9)
        expect(c.y).toBeLessThanOrEqual(640 + h / 2 / z + 1e-9)
        const [px, py] = [c.x, c.y]
        c.clamp()
        expect([c.x, c.y]).toEqual([px, py])
      }),
      { seed },
    )
  })

  it('P-C4 a pan followed by the opposite pan returns to the start (away from the clamp)', () => {
    fc.assert(
      fc.property(zoom, fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), (z, dx, dy) => {
        const c = camera(100_000, 100_000, 400, 800, z, 50_000, 50_000)
        c.panBy(dx, dy)
        c.panBy(-dx, -dy)
        expect(Math.abs(c.x - 50_000)).toBeLessThan(1e-6)
        expect(Math.abs(c.y - 50_000)).toBeLessThan(1e-6)
      }),
      { seed },
    )
  })

  it('far from the origin the maths stays exact (the camera lives in tile units from the map corner)', () => {
    const c = camera(36_000, 36_000, 1200, 800, 48, 35_999.37, 35_999.91)
    const t = c.screenToTile(1199, 799)
    const s = c.tileToScreen(t.x, t.y)
    expect(Math.abs(s.x - 1199)).toBeLessThan(1e-7)
    expect(Math.abs(s.y - 799)).toBeLessThan(1e-7)
  })

  it('fit picks the largest ladder zoom whose box fits and centres it', () => {
    const c = camera(600, 600, 400, 800, 16, 0, 0)
    c.fit([{ x: 100, y: 100 }, { x: 140, y: 190 }], 48)
    expect(c.x).toBe(120)
    expect(c.y).toBe(145)
    // 304 / 40 = 7.6 wide, 704 / 90 = 7.8 tall, so the largest level at or below 7.6.
    expect(c.zoom).toBe(6)
  })
})

describe('zoom ladder', () => {
  it('B12 steps to the next level from between two levels', () => {
    expect(nextZoom(10, 1)).toBe(16)
    expect(nextZoom(10, -1)).toBe(8)
    expect(nextZoom(8, 1)).toBe(16)
    expect(nextZoom(48, 1)).toBe(48)
    expect(nextZoom(0.5, -1)).toBe(0.5)
  })
  it('nearestZoom is the nearest on a log scale', () => {
    expect(nearestZoom(11)).toBe(8) // 11/8 = 1.375, 16/11 = 1.45
    expect(nearestZoom(12)).toBe(16)
  })
})

describe('backing store (B5)', () => {
  it('leaves normal phones alone', () => {
    expect(backingSize(390, 844, 3)).toEqual({ w: 1170, h: 2532, dpr: 3 })
  })
  it('property: always within 8192 px per side and 16.7 Mpx, and never above the wanted ratio', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6000 }), fc.integer({ min: 1, max: 6000 }), fc.double({ min: 0.5, max: 4, noNaN: true }), (cw, ch, dpr) => {
        const b = backingSize(cw, ch, dpr)
        expect(b.w).toBeLessThanOrEqual(MAX_SIDE)
        expect(b.h).toBeLessThanOrEqual(MAX_SIDE)
        expect(b.w * b.h).toBeLessThanOrEqual(MAX_PIXELS)
        expect(b.dpr).toBeLessThanOrEqual(dpr + 1e-12)
        if (Math.round(cw * dpr) <= MAX_SIDE && Math.round(ch * dpr) <= MAX_SIDE && Math.round(cw * dpr) * Math.round(ch * dpr) <= MAX_PIXELS) expect(b.dpr).toBe(dpr)
        else expect(Math.abs(b.w / cw - b.dpr)).toBeLessThan(1 / cw + 1e-9)
      }),
      { seed },
    )
  })
  it('a hidden canvas has no backing store to size', () => {
    expect(backingSize(0, 0, 3)).toEqual({ w: 0, h: 0, dpr: 3 })
  })
})

describe('minimum zoom (requirement 19.20)', () => {
  it('stops every zoom path at the floor and leaves the default unchanged', () => {
    const c = new Camera(100, 100)
    c.setSize(390, 844)
    c.zoom = 2
    c.zoomStep(-1)
    c.zoomStep(-1)
    c.zoomStep(-1)
    expect(c.zoom).toBe(0.75)
    c.minZoom = 1.5
    c.zoomTo(0.5)
    expect(c.zoom).toBe(1.5)
    c.zoomStep(-1)
    expect(c.zoom).toBe(1.5)
    c.zoomStep(1)
    expect(c.zoom).toBe(2)
  })
  it('property: zoomTo never ends below the floor', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ZOOM_LEVELS), fc.constantFrom(...ZOOM_LEVELS), (floor, target) => {
        const c = new Camera(50, 50)
        c.setSize(300, 300)
        c.minZoom = floor
        c.zoomTo(target)
        expect(c.zoom).toBe(Math.max(floor, target))
      }),
    )
  })
})
