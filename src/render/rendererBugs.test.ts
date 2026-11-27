import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Layer, TileGrid } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { lampsInChunk } from './lamps.ts'
import { MapRenderer, sceneMargin } from './MapRenderer.ts'
import { planChunks } from './chunkPlan.ts'

/** Regression tests for the bugs found in the Nov 2026 review (design.md, B3 to B15). Each failed on the old renderer. */
const grid = buildTileGrid(loadDemoOsm())

type Call = { name: string; args: unknown[]; fillStyle: string }

/** Main canvas context that logs calls; every other canvas (chunks, atlas) gets a silent context. */
function logging(main: HTMLCanvasElement) {
  const calls: Call[] = []
  let fillStyle = ''
  const make = (log: boolean) =>
    new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => {
        if (k in t) return t[k]
        if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
        if (k === 'measureText') return () => ({ width: 1 })
        return (...args: unknown[]) => {
          if (log) calls.push({ name: k, args, fillStyle })
        }
      },
      set: (t, k: string, v) => {
        t[k] = v
        if (log && k === 'fillStyle') fillStyle = String(v)
        return true
      },
    })
  const mainCtx = make(true)
  const scratch = make(false)
  // The map is drawn into the cached scene canvas (the screen plus a margin), then blitted to `main`.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return (this === main || this.width > main.width ? mainCtx : scratch) as never
  })
  return calls
}

function canvasOf(w: number, h: number) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true })
  return canvas
}

beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(1000)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('B3 hidden canvas', () => {
  it('does not grow the backing store when the canvas has no layout size', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const canvas = canvasOf(0, 0)
    logging(canvas)
    const before = canvas.width
    const r = new MapRenderer(canvas, grid)
    for (let i = 0; i < 4; i++) r.render()
    expect(canvas.width).toBe(before)
    r.dispose()
  })
})

describe('B5 backing store limit', () => {
  it('keeps big, dense screens inside 8192 px per side and 16.7 Mpx', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const canvas = canvasOf(2400, 1600)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.render()
    expect(canvas.width).toBeLessThanOrEqual(8192)
    expect(canvas.height).toBeLessThanOrEqual(8192)
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_777_216)
    expect(canvas.width).toBeGreaterThan(2400) // still sharper than 1×
    r.dispose()
  })
})

describe('B4 pixel ratio change', () => {
  it('repaints at the new ratio when only the ratio changes (window moved to another screen)', () => {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let listener: (() => void) | undefined
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener: (_: string, l: () => void) => (listener = l),
      removeEventListener: () => {},
    }))
    vi.stubGlobal('devicePixelRatio', 1)
    const canvas = canvasOf(400, 300)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.requestRender()
    while (queue.length) queue.shift()!(0)
    expect(canvas.width).toBe(400)
    vi.stubGlobal('devicePixelRatio', 2)
    expect(listener).toBeTypeOf('function')
    listener?.()
    while (queue.length) queue.shift()!(0)
    expect(canvas.width).toBe(800)
    r.dispose()
  })
})

describe('B15 background tab', () => {
  it('repaints when the page becomes visible again', () => {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const canvas = canvasOf(300, 200)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.requestRender()
    while (queue.length) queue.shift()!(0)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(queue.length).toBeGreaterThan(0)
    r.dispose()
  })
})

describe('B6 light over stand-ins', () => {
  it('draws no window light over chunks that are still stand-ins', () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10))
    const canvas = canvasOf(500, 400)
    const calls = logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.setClockOverride(23 * 60)
    // On a chunk corner, so several chunks are visible and the budget paints only the first.
    r.centerOn(grid.tileToLatLon(32 * 8, 32 * 8), 16)
    r.render()
    const plan = planChunks({ camX: r.camX, camY: r.camY, zoom: r.zoom, cssW: 500, cssH: 400, cols: grid.cols, rows: grid.rows, chunk: 32, margin: 1 })
    expect(plan.visible.length).toBeGreaterThan(1)
    expect(r.chunkCount).toBe(1)
    const first = plan.visible[0]!
    const m = sceneMargin(500, 400)
    const ox = Math.round(250 - r.camX * 16) + m
    const oy = Math.round(200 - r.camY * 16) + m
    const inside = (x: number, y: number) => x >= ox + first.cx * 512 && x < ox + (first.cx + 1) * 512 && y >= oy + first.cy * 512 && y < oy + (first.cy + 1) * 512
    const windows = calls.filter((c) => c.name === 'fillRect' && c.fillStyle === '#ffd36b')
    expect(windows.length).toBeGreaterThan(0)
    for (const w of windows) expect(inside(w.args[0] as number, w.args[1] as number)).toBe(true)
    r.dispose()
  })
})

describe('B7 stand-in rectangles', () => {
  it.each([1.1, 1.25, 1.33, 1.75, 2.2])('cover the loaded area without gaps at pixel ratio %s', (dpr) => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10))
    vi.stubGlobal('devicePixelRatio', dpr)
    const canvas = canvasOf(500, 400)
    const calls = logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.centerOn(grid.tileToLatLon(300, 300), 8)
    r.render()
    const w = canvas.width
    const h = canvas.height
    const covered = new Uint8Array(w * h)
    for (const c of calls) {
      if (c.name !== 'drawImage' || c.args.length < 5) continue
      const [dx, dy, dw, dh] = c.args.length === 9 ? (c.args.slice(5) as number[]) : (c.args.slice(1) as number[])
      if (dw! < 64) continue
      for (let y = Math.max(0, dy!); y < Math.min(h, dy! + dh!); y++) for (let x = Math.max(0, dx!); x < Math.min(w, dx! + dw!); x++) covered[y * w + x] = 1
    }
    expect(covered.reduce((n, v) => n + (v ? 0 : 1), 0)).toBe(0)
    r.dispose()
  })
})

describe('B9 memory', () => {
  it('releases evicted chunk canvases and everything on dispose', () => {
    const made: HTMLCanvasElement[] = []
    const real = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = real(tag)
      if (tag === 'canvas') made.push(el as HTMLCanvasElement)
      return el
    }) as never)
    const canvas = canvasOf(500, 400)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.zoom = 8
    // Walk across the whole map so far more than 96 chunks are painted.
    for (let y = 0; y < grid.rows; y += 100) {
      for (let x = 0; x < grid.cols; x += 100) {
        r.camX = x
        r.camY = y
        for (let i = 0; i < 12; i++) r.render()
      }
    }
    const live = () => made.filter((c) => c.width === 512).length
    expect(live()).toBeLessThanOrEqual(r.chunkCount)
    r.dispose()
    expect(live()).toBe(0)
  })
})

describe('B10 no animation frames available', () => {
  it('a moving walker does not recurse without end', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const canvas = canvasOf(300, 200)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    const a = grid.tileToLatLon(100, 100)
    const b = grid.tileToLatLon(103, 100)
    r.setMarkers({ start: a })
    r.centerOn(a, 16)
    r.setQuest({ player: a, accuracyM: 3, collected: 0, alongM: 0 })
    expect(() => r.setQuest({ player: b, accuracyM: 3, collected: 0, alongM: 0 })).not.toThrow()
    r.dispose()
  })
})

describe('B11 lamp cache and chunk size', () => {
  it('answers for the chunk size asked', () => {
    const g = new TileGrid({ south: 39.49, north: 39.4935, west: -0.4, east: -0.39 })
    for (let x = 0; x < g.cols; x++) for (let y = 10; y < 13; y++) g.add(x, y, Layer.road | Layer.lit)
    g.resolveTerrain()
    const big = lampsInChunk(g, 0, 0, 64)
    expect(big.some((l) => l.x >= 16)).toBe(true)
    const small = lampsInChunk(g, 0, 0, 16)
    expect(small.length).toBeGreaterThan(0)
    for (const l of small) expect(l.x < 16 && l.y < 16).toBe(true)
  })
})

describe('B12 zoom ladder', () => {
  it('steps to the next level from a zoom between two levels', () => {
    const r = new MapRenderer(canvasOf(300, 200), grid)
    r.zoom = 10
    r.zoomStep(1)
    expect(r.zoom).toBe(16)
    r.zoom = 10
    r.zoomStep(-1)
    expect(r.zoom).toBe(8)
    r.dispose()
  })
})

describe('B14 resize', () => {
  it('pulls the camera back inside the allowed margin when the screen gets smaller', () => {
    const canvas = canvasOf(800, 600)
    logging(canvas)
    const r = new MapRenderer(canvas, grid)
    r.zoom = 16
    r.camX = grid.cols + 25 // allowed at 800 px wide (400 / 16)
    r.render()
    Object.defineProperty(canvas, 'clientWidth', { value: 160, configurable: true })
    r.render()
    expect(r.camX).toBeLessThanOrEqual(grid.cols + 160 / 2 / 16 + 1e-9)
    r.dispose()
  })
})
