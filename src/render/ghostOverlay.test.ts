import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startPacer, paceFor } from '../ghost/pacer.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer, type QuestOverlay, type RouteShape } from './MapRenderer.ts'
import { OverlayLayer } from './overlayLayer.ts'
import type { LightingLayer } from './lightingLayer.ts'
import { installSoftCanvas, SoftCanvas } from './testing/softCanvas.ts'

const grid = buildTileGrid(loadDemoOsm())
const at = (tx: number, ty: number) => grid.tileToLatLon(tx, ty)
const cx = Math.floor(grid.cols / 2)
const cy = Math.floor(grid.rows / 2)
const pts = [at(cx, cy), at(cx + 30, cy), at(cx + 30, cy + 30), at(cx + 60, cy + 30)]
const total = cumulativeDistances(pts).at(-1)!
const route: RouteShape = {
  points: pts,
  checkpoints: [
    { index: 1, point: pts[2]!, distanceM: total / 2, isFinish: false },
    { index: 2, point: pts[3]!, distanceM: total, isFinish: true },
  ],
}

let now = 0
let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

const base = (extra: Partial<QuestOverlay>): QuestOverlay => ({ player: pts[0], accuracyM: undefined, collected: 0, alongM: 0, ...extra })

function frame(quest: QuestOverlay, bubble?: string): string {
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = 240
  canvas.clientHeight = 180
  const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, grid)
  r.setClockOverride(13 * 60)
  r.centerOn(pts[0]!, 24)
  r.setRoute(route)
  r.setQuest(quest)
  if (bubble) r.setBubble(bubble)
  r.render()
  r.dispose()
  return canvas.hash()
}

describe('simulated hero on the overlay', () => {
  const layer = () => {
    const o = new OverlayLayer(grid, {} as LightingLayer)
    o.setRoute(route)
    return o
  }
  it('walks the route at the constant simulated pace, whatever the frame times', () => {
    const o = layer()
    const mps = (5 / 3.6) * 5
    o.setQuest(base({ simMps: mps }))
    let last = o.walkerTile(0)!
    let t = 0
    for (const dt of [16, 33, 8, 120, 16, 16, 250, 40]) {
      t += dt
      now = t
      // Fixes keep coming slightly behind the frame clock, with noise.
      o.setQuest(base({ simMps: mps, alongM: Math.max(0, (mps * t) / 1000 - 3), player: pts[0] }))
      const p = o.walkerTile(t)!
      const moved = Math.hypot(p.x - last.x, p.y - last.y) * grid.metresPerTile
      expect(moved).toBeGreaterThan(0.85 * mps * (dt / 1000))
      expect(moved).toBeLessThan(1.15 * mps * (dt / 1000))
      last = p
    }
  })
})

describe('guide ghost on the overlay', () => {
  it('is drawn on the route when there is a pacer, and the frame changes', () => {
    const plan = startPacer(0, paceFor(0.75), { rate: 1 })
    const without = frame(base({}))
    const withGhost = frame(base({ ghost: { plan, pose: 'float' } }))
    expect(withGhost).not.toBe(without)
  })
  it('is drawn the same way for the same clock (sprites are cached frames, nothing random)', () => {
    const plan = startPacer(0, paceFor(0.75))
    expect(frame(base({ ghost: { plan, pose: 'boo' } }))).toBe(frame(base({ ghost: { plan, pose: 'boo' } })))
  })
  it('moves along the route as the clock runs', () => {
    const plan = startPacer(0, paceFor(0.75), { rate: 20 })
    const a = frame(base({ ghost: { plan, pose: 'float' } }))
    now = 20_000
    expect(frame(base({ ghost: { plan, pose: 'float' } }))).not.toBe(a)
  })
  it('is drawn while the hero walks (a moving walker must not skip the ghost)', () => {
    const plan = startPacer(0, paceFor(0.75), { rate: 1 })
    now = 3000
    const walking = { simMps: 1.4, alongM: 4 }
    expect(frame(base({ ...walking, ghost: { plan, pose: 'float' } }))).not.toBe(frame(base(walking)))
  })
  it('stays visible with a speech bubble up (the bubble steps aside, the ghost is drawn over it)', () => {
    const plan = startPacer(0, paceFor(0.75), { rate: 1 })
    const text = 'En 30 metros, gira a la izquierda'
    expect(frame(base({ ghost: { plan, pose: 'float' } }), text)).not.toBe(frame(base({}), text))
  })
})
