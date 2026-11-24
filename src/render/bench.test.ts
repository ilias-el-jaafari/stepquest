import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer, type RouteShape } from './MapRenderer.ts'

/**
 * Steady-state frame cost with a long (about 7.5 km) route. The context is a
 * counting stub, so the time measured is the JavaScript side of a frame
 * (planning, allocation, call overhead) and the counts are the canvas calls a
 * browser has to execute. Counts are deterministic and asserted; times are
 * printed for the review (CI machines vary).
 */
const grid = buildTileGrid(loadDemoOsm())

type Counts = Record<string, number>
function stub() {
  const counts: Counts = {}
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get: (t, k: string) => {
      if (k in t) return t[k]
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
      if (k === 'measureText') return () => ({ width: 1 })
      return () => {
        counts[k] = (counts[k] ?? 0) + 1
      }
    },
    set: (t, k: string, v) => {
      t[k] = v
      return true
    },
  })
  return { ctx, counts }
}

/** A serpentine walk of about 1500 tiles (7.5 km): three passes over the width of the map, 20 tiles apart. */
function longRoute(): RouteShape {
  const points = []
  const x0 = 60
  const x1 = 560
  const y0 = 180
  for (let i = 0; i < 3; i++) {
    const east = i % 2 === 0
    points.push(grid.tileToLatLon(east ? x0 : x1, y0 + i * 20), grid.tileToLatLon(east ? x1 : x0, y0 + i * 20))
  }
  return { points, checkpoints: [{ index: 1, point: points[1]!, distanceM: 2500, isFinish: false }, { index: 2, point: points[points.length - 1]!, distanceM: 7500, isFinish: true }] }
}

const results: Record<string, { msPerFrame: number; counts: Counts }> = {}

function measure(name: string, zoom: number, frames: number, mutate: (r: MapRenderer, i: number) => void, time = 13 * 60) {
  const { ctx, counts } = stub()
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 390 })
  Object.defineProperty(canvas, 'clientHeight', { value: 700 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  const r = new MapRenderer(canvas, grid)
  r.setClockOverride(time)
  r.setRoute(longRoute())
  r.centerOn(grid.tileToLatLon(300, 200), zoom)
  // Warm up: paint every chunk of the screen and its prefetch ring, and every atlas tile, then clear the counters.
  for (let i = 0; i < 80; i++) r.render()
  for (const k of Object.keys(counts)) delete counts[k]
  const t0 = performance.now()
  for (let i = 0; i < frames; i++) {
    mutate(r, i)
    r.render()
  }
  const ms = (performance.now() - t0) / frames
  r.dispose()
  const per: Counts = {}
  for (const [k, v] of Object.entries(counts)) per[k] = Math.round(v / frames)
  results[name] = { msPerFrame: Math.round(ms * 100) / 100, counts: per }
  return results[name]!
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 2)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const calls = (m: { counts: Counts }) => (m.counts.fillRect ?? 0) + (m.counts.drawImage ?? 0)

/** Run with the demo map's 62 track lines hidden, so the numbers are the route layer's own. */
function withoutTracks<T>(fn: () => T): T {
  const rails = grid.rails
  grid.rails = []
  try {
    return fn()
  } finally {
    grid.rails = rails
  }
}

describe('frame cost with a 7.5 km route', () => {
  it('detail zoom, still camera (walker animating)', () => {
    expect(calls(measure('detail-still', 16, 60, () => {}))).toBeLessThan(1500)
  })
  it('detail zoom, panning', () => {
    expect(calls(measure('detail-pan', 16, 60, (r, i) => r.panBy(i % 2 ? 7 : -7, 3)))).toBeLessThan(1500)
  })
  it('far zoom, route only: under 1500 calls (requirement 12.1)', () => {
    expect(calls(withoutTracks(() => measure('far-route-only', 1, 60, () => {})))).toBeLessThan(1500)
  })
  it('detail zoom, route only: under 1500 calls (requirement 12.1)', () => {
    expect(calls(withoutTracks(() => measure('detail-route-only', 16, 60, () => {})))).toBeLessThan(1500)
  })
  it('far zoom with the demo map tracks (report)', () => {
    expect(calls(measure('far-with-tracks', 1, 60, () => {}))).toBeLessThan(20_000)
  })
  it('night, detail zoom', () => {
    expect(calls(measure('night', 16, 60, () => {}, 22 * 60))).toBeLessThan(1500)
  })
  it('prints the table', () => {
    ;(globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout.write('\nBENCH ' + JSON.stringify(results) + '\n')
    expect(Object.keys(results).length).toBeGreaterThan(0)
  })
})
