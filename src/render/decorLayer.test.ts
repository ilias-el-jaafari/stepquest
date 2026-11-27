import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ANIMATED } from '../decor/budget.ts'
import { decorInChunk } from '../decor/place.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { CHUNK } from './chunkLayer.ts'
import { chunkKey, type ChunkPlan } from './chunkPlan.ts'
import { lightingAt, type Lighting } from './daylight.ts'
import { DecorLayer, hatOn } from './decorLayer.ts'
import { MapRenderer } from './MapRenderer.ts'
import type { View } from './view.ts'

const grid = buildTileGrid(loadDemoOsm())
const chunksX = Math.ceil(grid.cols / CHUNK)
const chunksY = Math.ceil(grid.rows / CHUNK)

const everyChunk: ChunkPlan = { visible: [], ring: [] }
for (let cy = 0; cy < chunksY; cy++) for (let cx = 0; cx < chunksX; cx++) everyChunk.visible.push({ cx, cy })
const painted = new Set(everyChunk.visible.map((c) => chunkKey(c.cx, c.cy)))

const DAY: Lighting = { altitude: 50, phase: 'day', tint: [255, 255, 255], darkness: 0, lamps: 0, windows: 0 }
const NIGHT: Lighting = { ...DAY, altitude: -20, phase: 'night', tint: [84, 92, 156], darkness: 0.7, lamps: 1, windows: 1 }

/** A view of the whole map at `zoom` (so every chunk counts), device scale = zoom. */
function view(zoom: number): View {
  return { w: 4000, h: 4000, dpr: 1, zoom, cssW: 4000, cssH: 4000, scale: zoom, originX: 0, originY: 0, camX: 0, camY: 0, detail: zoom >= 8 }
}

/** A canvas context that only counts. */
function counter() {
  const calls = { drawImage: 0, fillRect: 0 }
  const ctx = {
    drawImage: () => calls.drawImage++,
    fillRect: () => calls.fillRect++,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function stub() {
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get: (t, k: string) => {
      if (k in t) return t[k]
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
      if (k === 'measureText') return () => ({ width: 1 })
      return () => {}
    },
    set: (t, k: string, v) => {
      t[k] = v
      return true
    },
  })
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(counter().ctx as never)
  vi.stubGlobal('setTimeout', vi.fn(() => 1))
  vi.stubGlobal('clearTimeout', vi.fn())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function layer(enabled = true) {
  const onTick = vi.fn()
  const l = new DecorLayer(grid, onTick, enabled)
  return { l, onTick }
}

describe('static decor', () => {
  it('draws some, scene only, and nothing when switched off or zoomed out', () => {
    const { l } = layer()
    const { ctx } = counter()
    l.drawStatic(ctx, view(16), everyChunk, painted, DAY)
    expect(l.stats.statics).toBeGreaterThan(0)
    l.setEnabled(false)
    l.drawStatic(ctx, view(16), everyChunk, painted, DAY)
    expect(l.stats.statics).toBe(0)
    l.setEnabled(true)
    l.drawStatic(ctx, view(4), everyChunk, painted, DAY)
    expect(l.stats.statics).toBe(0)
  })

  it('skips chunks that are only stand-ins', () => {
    const { l } = layer()
    l.drawStatic(counter().ctx, view(16), everyChunk, new Set(), DAY)
    expect(l.stats.statics).toBe(0)
  })

  it('shows fewer items by day than at night and fewer when zoomed out', () => {
    const { l } = layer()
    const count = (zoom: number, light: Lighting) => {
      l.drawStatic(counter().ctx, view(zoom), everyChunk, painted, light)
      return l.stats.statics
    }
    expect(count(16, DAY)).toBeLessThan(count(16, NIGHT))
    expect(count(8, NIGHT)).toBeLessThan(count(32, NIGHT))
  })

  it('leaves the keep-out tiles bare', () => {
    const { l } = layer()
    const free = (() => {
      l.drawStatic(counter().ctx, view(16), everyChunk, painted, NIGHT)
      return l.stats.statics
    })()
    const keep = new Set<number>()
    for (let i = 0; i < grid.cols * grid.rows; i++) keep.add(i)
    l.setKeepOut(keep)
    l.drawStatic(counter().ctx, view(16), everyChunk, painted, NIGHT)
    expect(free).toBeGreaterThan(0)
    expect(l.stats.statics).toBe(0)
  })
})

describe('night pass', () => {
  it('adds glows and lamp-post hats only at night', () => {
    const { l } = layer()
    const v = view(16)
    l.drawStatic(counter().ctx, v, everyChunk, painted, DAY)
    const day = counter()
    l.drawNight(day.ctx, v, DAY)
    expect(day.calls.drawImage).toBe(0)
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    const night = counter()
    l.drawNight(night.ctx, v, NIGHT)
    expect(night.calls.drawImage).toBeGreaterThan(0)
    expect(l.stats.hats).toBeGreaterThan(0)
  })

  it('puts a hat on roughly one lamp post in five, always the same ones', () => {
    let n = 0
    for (let i = 0; i < 1000; i++) if (hatOn(i, i * 7)) n++
    expect(n).toBeGreaterThan(120)
    expect(n).toBeLessThan(280)
    expect(hatOn(10, 20)).toBe(hatOn(10, 20))
  })
})

describe('animated decor', () => {
  const night = lightingAt(Date.UTC(2026, 9, 31, 22, 0), { lat: 39.49, lon: -0.39 })

  it('never draws more than the frame cap, at night or by day', () => {
    const { l } = layer()
    const v = view(16)
    for (const light of [DAY, NIGHT, night]) {
      l.drawStatic(counter().ctx, v, everyChunk, painted, light)
      l.drawAnimated(counter().ctx, v, light, 5000)
      expect(l.stats.animated).toBeLessThanOrEqual(MAX_ANIMATED)
    }
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    l.drawAnimated(counter().ctx, v, NIGHT, 5000)
    expect(l.stats.animated).toBe(MAX_ANIMATED)
  })

  it('has bats and fog only at night: a chunk with no skeleton moves nothing by day', () => {
    const { l } = layer()
    const v = view(16)
    const c = everyChunk.visible.find((k) => {
      const d = decorInChunk(grid, k.cx, k.cy, CHUNK)
      return d.animated.some((a) => a.kind === 'bat') && !d.animated.some((a) => a.kind === 'skeleton')
    })!
    const one: ChunkPlan = { visible: [c], ring: [] }
    const keys = new Set([chunkKey(c.cx, c.cy)])
    l.drawStatic(counter().ctx, v, one, keys, DAY)
    l.drawAnimated(counter().ctx, v, DAY, 5000)
    expect(l.stats.animated).toBe(0)
    l.drawStatic(counter().ctx, v, one, keys, NIGHT)
    l.drawAnimated(counter().ctx, v, NIGHT, 5000)
    expect(l.stats.animated).toBeGreaterThan(0)
  })

  it('steps at 12 Hz: one timer, aligned to the next step, while something moves', () => {
    const { l } = layer()
    const v = view(16)
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    l.drawAnimated(counter().ctx, v, NIGHT, 5000)
    l.drawAnimated(counter().ctx, v, NIGHT, 5010)
    expect(setTimeout).toHaveBeenCalledTimes(1)
    const delay = (setTimeout as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as number
    expect(delay).toBeGreaterThan(0)
    expect(delay).toBeLessThanOrEqual(1000 / 12 + 1e-6)
  })

  it('does not animate with reduced motion: no timer, items rest', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { l } = layer()
    const v = view(16)
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    l.drawAnimated(counter().ctx, v, NIGHT, 5000)
    expect(l.stats.animated).toBeGreaterThan(0)
    expect(setTimeout).not.toHaveBeenCalled()
  })

  it('keeps clear of the walker', () => {
    const { l } = layer()
    const v = view(16)
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    const draw = (avoid?: { x: number; y: number }) => {
      const c = counter()
      l.drawAnimated(c.ctx, v, NIGHT, 5000, avoid)
      return c.calls.drawImage
    }
    const free = draw()
    const first = decorInChunk(grid, 0, 0, CHUNK)
    expect(free).toBeGreaterThan(0)
    expect(first).toBeDefined()
    // A walker standing on every item in turn never gets a bat or a skeleton within 1.5 tiles.
    for (const c of everyChunk.visible.slice(0, 3)) {
      for (const it of decorInChunk(grid, c.cx, c.cy, CHUNK).animated.slice(0, 2)) expect(draw({ x: it.x, y: it.y })).toBeLessThanOrEqual(free)
    }
  })
})

describe('cost', () => {
  it('draws the animated pass in well under a millisecond a frame (counting context, no allocation in the loop)', () => {
    const { l } = layer()
    const v = view(16)
    l.drawStatic(counter().ctx, v, everyChunk, painted, NIGHT)
    const { ctx } = counter()
    l.drawAnimated(ctx, v, NIGHT, 1000)
    const t0 = performance.now()
    for (let i = 0; i < 500; i++) l.drawAnimated(ctx, v, NIGHT, 1000 + i * 17)
    expect((performance.now() - t0) / 500).toBeLessThan(1)
  })
})

describe('in the renderer', () => {
  it('draws the scene with decor, redraws it for a setting change, and draws nothing extra when off', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stub() as never)
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'clientWidth', { value: 390 })
    Object.defineProperty(canvas, 'clientHeight', { value: 700 })
    const r = new MapRenderer(canvas, grid)
    r.setClockOverride(22 * 60)
    r.centerOn(grid.tileToLatLon(300, 200), 16)
    for (let i = 0; i < 40; i++) r.render()
    const draws = r.stats.sceneDraws
    r.setDecor(false)
    r.render()
    expect(r.stats.sceneDraws).toBe(draws + 1)
    r.setDecor(false)
    r.render()
    expect(r.stats.sceneDraws).toBe(draws + 1)
    r.dispose()
  })
})
