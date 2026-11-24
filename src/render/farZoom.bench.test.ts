import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cellBBox, type CellId } from '../world/cells.ts'
import { LiveWorld } from '../world/liveWorld.ts'
import { makeRecord, type SketchWay } from '../world/testing.ts'
import { MAX_RADIUS_CELLS } from '../world/tileWorld.ts'
import { MapRenderer } from './MapRenderer.ts'

/**
 * Far-zoom render budget (requirement 19.13): a whole frame of 9 × 9 loaded cells (about 10 × 7.7 km)
 * drawn at the far zooms. The context is a counting stub, so the time is the JavaScript side of a
 * frame and the counts are the canvas calls; times are printed, counts asserted.
 */
const C: CellId = { i: 3949, j: -40 }

/** A cell of streets every ~110 m both ways, a park and a pond. */
function syntheticCell(c: CellId, id0: number) {
  const b = cellBBox(c)
  const ways: SketchWay[] = []
  let id = id0
  for (let k = 0; k <= 10; k++) {
    const lat = b.south + (k / 10) * (b.north - b.south)
    const lon = b.west + (k / 10) * (b.east - b.west)
    ways.push({ id: id++, pts: [[lat, b.west], [lat, b.east]] })
    ways.push({ id: id++, pts: [[b.south, lon], [b.north, lon]] })
  }
  const box = (s: number, w: number, n: number, e: number): [number, number][] => [[s, w], [s, e], [n, e], [n, w], [s, w]]
  ways.push({ id: id++, kind: 'park', area: true, pts: box(b.south + 0.0012, b.west + 0.0012, b.south + 0.0028, b.west + 0.0048) })
  ways.push({ id: id++, kind: 'water', area: true, pts: box(b.south + 0.0062, b.west + 0.0062, b.south + 0.0078, b.west + 0.0078) })
  for (let k = 0; k < 6; k++) ways.push({ id: id++, kind: 'building', area: true, pts: box(b.south + 0.0042, b.west + 0.0012 + k * 0.0012, b.south + 0.0058, b.west + 0.0018 + k * 0.0012) })
  return makeRecord(c, ways)
}

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

const results: Record<string, unknown> = {}
let world: LiveWorld

beforeEach(() => vi.stubGlobal('devicePixelRatio', 3))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('far-zoom render budget on a full 9 × 9 cell world', () => {
  it('builds the world', () => {
    const t0 = performance.now()
    const recs = []
    const r = MAX_RADIUS_CELLS
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) recs.push(syntheticCell({ i: C.i + di, j: C.j + dj }, ((di + r) * 9 + dj + r) * 1000 + 1))
    world = new LiveWorld(C, recs)
    results.buildMs = Math.round(performance.now() - t0)
    results.perCellMs = Math.round((performance.now() - t0) / recs.length)
    expect(world.cellCount).toBe(81)
  })

  for (const zoom of [0.5, 1, 1.5, 2, 4]) {
    it(`zoom ${zoom}: one overview draw per frame, nothing per house or tile`, () => {
      const { ctx, counts } = stub()
      const canvas = document.createElement('canvas')
      Object.defineProperty(canvas, 'clientWidth', { value: 390 })
      Object.defineProperty(canvas, 'clientHeight', { value: 844 })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
      const r = new MapRenderer(canvas, world)
      r.setClockOverride(22 * 60)
      r.centerOn(world.grid.tileToLatLon(world.grid.cols / 2, world.grid.rows / 2), zoom)
      const t0 = performance.now()
      r.render()
      const firstMs = performance.now() - t0
      for (const k of Object.keys(counts)) delete counts[k]
      const frames = 30
      const t1 = performance.now()
      for (let i = 0; i < frames; i++) {
        r.panBy(i % 2 ? 9 : -9, 0)
        r.render()
      }
      const ms = (performance.now() - t1) / frames
      r.dispose()
      const per: Counts = {}
      for (const [k, v] of Object.entries(counts)) per[k] = Math.round(v / frames)
      results[`zoom ${zoom}`] = { firstFrameMs: Math.round(firstMs), msPerFrame: Math.round(ms * 100) / 100, counts: per }
      expect(per.drawImage ?? 0).toBeLessThanOrEqual(3)
      expect(per.fillRect ?? 0).toBeLessThan(20)
      expect(ms).toBeLessThan(50)
    })
  }

  it('prints the table', () => {
    ;(globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout.write('\nFAR-BENCH ' + JSON.stringify(results) + '\n')
    expect(Object.keys(results).length).toBeGreaterThan(5)
  })
})
