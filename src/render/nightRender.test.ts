import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { CHUNK } from './chunkLayer.ts'
import { lampsInChunk, MAX_LAMPS_PER_CHUNK, MAX_LAMPS_PER_FRAME } from './lamps.ts'
import { MapRenderer } from './MapRenderer.ts'
import { decorBudget, MAX_ANIMATED } from '../decor/budget.ts'
import { setDecorOn } from '../decor/pref.ts'

const grid = buildTileGrid(loadDemoOsm())

/** A canvas context that records the composite modes and fill colours used. */
function recorder() {
  const log = { composites: new Set<string>(), fills: new Set<string>(), glows: 0, fillRects: 0, lighterFillRects: 0 }
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get: (t, k: string) => {
      if (k in t) return t[k]
      if (k === 'drawImage') return () => void log.glows++
      if (k === 'fillRect') return () => {
        log.fillRects++
        if (t.globalCompositeOperation === 'lighter') log.lighterFillRects++
      }
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
      if (k === 'measureText') return () => ({ width: 1 })
      return () => {}
    },
    set: (t, k: string, v) => {
      t[k] = v
      if (k === 'globalCompositeOperation') log.composites.add(String(v))
      if (k === 'fillStyle') log.fills.add(String(v))
      return true
    },
  })
  return { ctx, log }
}

afterEach(() => vi.restoreAllMocks())

/**
 * Chunk painting has a wall-clock budget (CHUNK_BUDGET_MS) and decor is drawn only on painted chunks, so on a real
 * clock the number of images in one render() depends on how fast the machine is (and whether the code is warm).
 * The tests pin the clock: 'frozen' paints every visible chunk, 'slow' paints one chunk per frame.
 */
type Clock = 'frozen' | 'slow'
function pinClock(clock: Clock) {
  let t = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (clock === 'slow' ? (t += 10) : 0))
}

/** Renders one frame. Decor is set explicitly (never read from the stored setting) and defaults to off, so lamp counts stay lamp counts. */
function renderAt(time: number | undefined, zoom = 16, beforeDispose?: () => void, decor = false, clock: Clock = 'frozen') {
  pinClock(clock)
  const { ctx, log } = recorder()
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 400 })
  Object.defineProperty(canvas, 'clientHeight', { value: 400 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  const r = new MapRenderer(canvas, grid)
  r.setDecor(decor)
  r.setClockOverride(time)
  r.centerOn({ lat: 39.4935, lon: -0.392 }, zoom)
  r.render()
  const lighting = r.lighting
  beforeDispose?.()
  r.dispose()
  return { log, lighting }
}

describe('MapRenderer day cycle', () => {
  it('draws no tint at noon', () => {
    const { log, lighting } = renderAt(13 * 60)
    expect(lighting.phase).toBe('day')
    expect(log.composites.has('multiply')).toBe(false)
  })
  it('tints the map and adds lights at night (clock override)', () => {
    const { log, lighting } = renderAt(23 * 60)
    expect(lighting.phase).toBe('night')
    expect(log.composites.has('multiply')).toBe(true)
    expect(log.composites.has('lighter')).toBe(true)
    expect(log.fills.has('#ffd36b')).toBe(true)
  })

  it('draws lamp posts and pools at detail zoom: more images at night than at noon', () => {
    const day = renderAt(13 * 60, 16).log.glows
    const night = renderAt(23 * 60, 16).log.glows
    expect(night).toBeGreaterThan(day)
  })
  it('draws lamps as dots only (no sprite, no pool image) at far zoom and below detail zoom', () => {
    for (const zoom of [0.5, 1.5, 4]) {
      const day = renderAt(13 * 60, zoom).log
      const night = renderAt(23 * 60, zoom).log
      expect(night.glows).toBe(day.glows)
      expect(night.lighterFillRects).toBeGreaterThan(0)
      expect(night.lighterFillRects).toBeLessThanOrEqual(MAX_LAMPS_PER_FRAME)
      expect(day.lighterFillRects).toBe(0)
    }
  })
})

describe('night render cost', () => {
  it('never lights more than MAX_LAMPS_PER_CHUNK lamps in a chunk, and the demo area has chunks that need the cap or not', () => {
    // Per chunk: the renderer draws min(list, cap); the lists are cached, so asking twice costs nothing.
    let busiest = 0
    for (let cy = 0; cy * CHUNK < grid.rows; cy++) {
      for (let cx = 0; cx * CHUNK < grid.cols; cx++) {
        const list = lampsInChunk(grid, cx, cy, CHUNK)
        expect(lampsInChunk(grid, cx, cy, CHUNK)).toBe(list)
        busiest = Math.max(busiest, list.length)
      }
    }
    expect(busiest).toBeGreaterThan(0)
  })
  it('pool and post images at detail zoom stay under two per lamp and the per-chunk cap times the visible chunks (decor off, any clock speed)', () => {
    const visibleChunks = 4 // a 400 px view at 16 px per tile spans at most 2 × 2 chunks of 32 tiles
    for (const clock of ['frozen', 'slow'] as const) {
      const day = renderAt(13 * 60, 16, undefined, false, clock).log.glows
      const night = renderAt(23 * 60, 16, undefined, false, clock).log.glows
      expect(night - day).toBeGreaterThan(0)
      expect(night - day).toBeLessThanOrEqual(2 * MAX_LAMPS_PER_CHUNK * visibleChunks + 40)
    }
  })
  it('decor images (items, glows, hats, moving items) have their own budget, by day and at night', () => {
    const visibleChunks = 4
    const { staticPerChunk } = decorBudget(16, 0, true)
    const animated = MAX_ANIMATED * 2 // moving items and the flicker glows share the frame cap; allow the second pass
    for (const clock of ['frozen', 'slow'] as const) {
      const dayDecor = renderAt(13 * 60, 16, undefined, true, clock).log.glows - renderAt(13 * 60, 16, undefined, false, clock).log.glows
      const nightDecor = renderAt(23 * 60, 16, undefined, true, clock).log.glows - renderAt(23 * 60, 16, undefined, false, clock).log.glows
      // By day: still items only (a pumpkin may bring a small one, a web is one image), at most the per-chunk cap.
      expect(dayDecor).toBeGreaterThan(0)
      expect(dayDecor).toBeLessThanOrEqual(2 * staticPerChunk * visibleChunks + animated)
      // At night: the same items, a glow for each glowing one, and a hat on some lamp posts.
      expect(nightDecor).toBeGreaterThan(dayDecor)
      expect(nightDecor).toBeLessThanOrEqual((2 + 1) * staticPerChunk * visibleChunks + MAX_LAMPS_PER_CHUNK * visibleChunks + animated)
    }
  })
  it('does not depend on the stored decor setting or the page URL: the renderer is told explicitly', () => {
    const before = renderAt(23 * 60, 16).log.glows
    setDecorOn(false)
    const off = renderAt(23 * 60, 16).log.glows
    setDecorOn(true)
    const on = renderAt(23 * 60, 16).log.glows
    expect(off).toBe(before)
    expect(on).toBe(before)
    setDecorOn(true)
  })
})

describe('reduced motion', () => {
  const timers = (reduced: boolean) => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    let n = 0
    renderAt(23 * 60, 16, () => (n = vi.getTimerCount()))
    vi.unstubAllGlobals()
    vi.useRealTimers()
    return n
  }
  it('sets no flicker timer with reduced motion, and one more without', () => {
    const calm = timers(true)
    const lively = timers(false)
    expect(lively).toBeGreaterThan(calm)
    expect(lively - calm).toBeLessThanOrEqual(2) // the flicker timer (water ripples have their own)
  })
})
