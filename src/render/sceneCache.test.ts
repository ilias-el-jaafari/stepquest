import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer, sceneMargin, type QuestOverlay, type RouteShape } from './MapRenderer.ts'

/**
 * Dirty-flag rendering: the map under the overlay (ground, chunks, water, tracks, tint, night light) is
 * drawn into a cached scene and redrawn only when something it shows changed. A frame that only moves the
 * walker, the pickups or the camera inside the scene's margin is one blit plus the overlay.
 */
const grid = buildTileGrid(loadDemoOsm())
const at = (x: number, y: number) => grid.tileToLatLon(x, y)

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

const route: RouteShape = {
  points: [at(300, 200), at(310, 200), at(320, 205)],
  checkpoints: [{ index: 1, point: at(310, 200), distanceM: 50, isFinish: true }],
}
const quest = (x: number, y: number): QuestOverlay => ({ player: at(x, y), accuracyM: undefined, collected: 0, alongM: 0 })

let clock = 1000

function renderer(time = 13 * 60) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 390 })
  Object.defineProperty(canvas, 'clientHeight', { value: 700 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stub() as never)
  const r = new MapRenderer(canvas, grid)
  r.setClockOverride(time)
  r.setRoute(route)
  r.centerOn(at(300, 200), 16)
  // Settle: every chunk of the screen and its ring painted, no stand-in left.
  for (let i = 0; i < 120; i++) r.render()
  return r
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 3)
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('scene cache (dirty-flag rendering)', () => {
  it('a settled map with a walking hero redraws no scene: 60 frames, 0 scene draws', () => {
    const r = renderer()
    r.setQuest(quest(300, 200))
    r.render()
    const before = { ...r.stats }
    for (let i = 0; i < 60; i++) {
      r.setQuest(quest(300 + (i % 20) * 0.01, 200))
      r.render()
    }
    expect(r.stats.frames - before.frames).toBe(60)
    expect(r.stats.sceneDraws - before.sceneDraws).toBe(0)
    r.dispose()
  })

  it('pans inside the margin by blitting, and redraws once when the camera leaves it', () => {
    const r = renderer(22 * 60)
    const css = 390
    const margin = sceneMargin(Math.round(css * 2), Math.round(700 * 2))
    expect(margin).toBeGreaterThan(0)
    const base = r.stats.sceneDraws
    // The ratio is capped at 2, so 1 CSS px is 2 backing px: stay well inside the margin.
    r.panBy(margin / 2 / 2, 0)
    r.render()
    expect(r.stats.sceneDraws).toBe(base)
    r.panBy(margin, 0)
    r.render()
    expect(r.stats.sceneDraws).toBe(base + 1)
    r.render()
    expect(r.stats.sceneDraws).toBe(base + 1)
    r.dispose()
  })

  it('redraws on a zoom step, a new clock and a new tile set, and not for route, walker or bubble', () => {
    const r = renderer()
    let n = r.stats.sceneDraws
    r.zoomStep(1)
    r.render()
    expect(r.stats.sceneDraws).toBeGreaterThan(n)
    for (let i = 0; i < 60; i++) r.render()
    n = r.stats.sceneDraws
    r.setClockOverride(21 * 60)
    r.render()
    expect(r.stats.sceneDraws).toBe(n + 1)
    for (let i = 0; i < 60; i++) r.render()
    n = r.stats.sceneDraws
    r.setRoute(route)
    r.setBubble('hello')
    r.setQuest(quest(301, 200))
    r.pickup(at(310, 200))
    r.setMarkers({ start: at(300, 200) })
    r.render()
    expect(r.stats.sceneDraws).toBe(n)
    r.dispose()
  })

  it('caps the backing store at 2 device pixels per CSS pixel (a 3x phone)', () => {
    const r = renderer()
    const canvas = (r as unknown as { canvas: HTMLCanvasElement }).canvas
    expect(canvas.width).toBe(780)
    expect(canvas.height).toBe(1400)
    r.dispose()
  })
})

describe('camera follow glides with the walker', () => {
  it('moves the camera a little every frame instead of snapping to each fix', () => {
    const r = renderer()
    r.setQuest(quest(300, 200))
    r.follow(at(300, 200))
    r.render()
    // Fixes arrive every 8 frames (about 130 ms), 0.4 tile apart; frames in between must still move the camera.
    const xs: number[] = []
    let x = 300
    for (let i = 0; i < 160; i++) {
      if (i % 8 === 0) {
        x += 0.4
        r.setQuest(quest(x, 200))
      }
      clock += 16.7
      r.render()
      xs.push(r.camX)
    }
    const steps = xs.slice(60).map((v, i, a) => (i ? v - a[i - 1]! : 0)).slice(1)
    expect(Math.min(...steps)).toBeGreaterThan(0)
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(2.5)
    r.stopFollow()
    const still = r.camX
    r.render()
    expect(r.camX).toBe(still)
    r.dispose()
  })
})
