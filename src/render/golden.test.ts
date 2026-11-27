import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { CHUNK } from './chunkLayer.ts'
import { firefliesInChunk } from './fireflies.ts'
import { lampsInChunk } from './lamps.ts'
import { MapRenderer, type QuestOverlay, type RouteShape } from './MapRenderer.ts'
import { installSoftCanvas, SoftCanvas } from './testing/softCanvas.ts'

/**
 * Golden frames: the look Ilias approved, pinned as pixel fingerprints of whole
 * frames drawn on a software canvas. A refactor must keep every hash; a visible
 * change needs a new hash AND a note in `design.md` (Architecture review).
 */
const grid = buildTileGrid(loadDemoOsm())
grid.rails = [
  [
    { x: 300, y: 300 },
    { x: 340, y: 310 },
    { x: 380, y: 305 },
  ],
]

let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  vi.spyOn(performance, 'now').mockReturnValue(1000)
})
afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

function findWater(): { x: number; y: number } {
  for (let i = 0; i < grid.terrain.length; i++) if (grid.terrain[i] === Terrain.water) return { x: i % grid.cols, y: Math.floor(i / grid.cols) }
  return { x: grid.cols / 2, y: grid.rows / 2 }
}

const at = (tx: number, ty: number) => grid.tileToLatLon(tx, ty)
const cx = Math.floor(grid.cols / 2)
const cy = Math.floor(grid.rows / 2)
const pts = [at(cx, cy), at(cx + 6, cy), at(cx + 6, cy + 5), at(cx + 14, cy + 5)]
const route: RouteShape = {
  points: pts,
  checkpoints: [
    { index: 1, point: pts[1]!, distanceM: 30, isFinish: false },
    { index: 2, point: pts[2]!, distanceM: 55, isFinish: false },
    { index: 3, point: pts[3]!, distanceM: 95, isFinish: true },
  ],
}

function frame(opts: { w?: number; h?: number; dpr?: number; time?: number; centre: { x: number; y: number }; zoom: number; decor?: boolean; setup?: (r: MapRenderer) => void }): string {
  vi.stubGlobal('devicePixelRatio', opts.dpr ?? 1)
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = opts.w ?? 240
  canvas.clientHeight = opts.h ?? 180
  const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, grid)
  // The approved frames predate the Halloween decor: they are drawn with it off; the decor has goldens of its own below.
  r.setDecor(opts.decor ?? false)
  r.setClockOverride(opts.time ?? 13 * 60)
  r.centerOn(at(opts.centre.x, opts.centre.y), opts.zoom)
  opts.setup?.(r)
  r.render()
  r.dispose()
  vi.unstubAllGlobals()
  return canvas.hash()
}

const quest = (p: { x: number; y: number }): QuestOverlay => ({ player: at(p.x, p.y), accuracyM: 3, collected: 1, alongM: 40, offRoute: true })

describe('golden frames', () => {
  it('planning map in daylight at detail zoom', () => {
    expect(frame({ centre: { x: cx + 5, y: cy + 3 }, zoom: 16, setup: (r) => { r.setRoute(route); r.setMarkers({ start: pts[0] }) } })).toMatchSnapshot()
  })
  it('night with lamps, windows, walker, bubble and a pickup, at 2x density', () => {
    expect(
      frame({
        dpr: 2,
        time: 22 * 60,
        centre: { x: cx + 6, y: cy + 4 },
        zoom: 24,
        setup: (r) => {
          r.setRoute(route)
          r.setQuest(quest({ x: cx + 6, y: cy + 3 }))
          r.setBubble('Turn left')
          r.pickup(pts[1]!)
        },
      }),
    ).toMatchSnapshot()
  })
  it('night with lamp posts, pools and fireflies at normal quest zoom, and the far-zoom dots', () => {
    let fly: { x: number; y: number } | undefined
    for (let j = 0; j * CHUNK < grid.rows && !fly; j++) for (let i = 0; i * CHUNK < grid.cols && !fly; i++) fly = firefliesInChunk(grid, i, j, CHUNK)[0]
    expect(fly).toBeDefined()
    const centre = { x: Math.floor(fly!.x), y: Math.floor(fly!.y) }
    expect(frame({ time: 22 * 60, centre, zoom: 16 })).toMatchSnapshot()
    let lamp: { x: number; y: number } | undefined
    for (let j = 0; j * CHUNK < grid.rows && !lamp; j++) for (let i = 0; i * CHUNK < grid.cols && !lamp; i++) lamp = lampsInChunk(grid, i, j, CHUNK)[0]
    expect(frame({ time: 22 * 60, centre: lamp!, zoom: 16, w: 160, h: 120 })).toMatchSnapshot()
    expect(frame({ time: 22 * 60, centre: { x: cx, y: cy }, zoom: 1.5 })).toMatchSnapshot()
  })
  it('lamp pools are warm and lit at night, and absent by day', () => {
    let lamp: { x: number; y: number } | undefined
    for (let j = 0; j * CHUNK < grid.rows && !lamp; j++) for (let i = 0; i * CHUNK < grid.cols && !lamp; i++) lamp = lampsInChunk(grid, i, j, CHUNK)[0]
    const night = frame({ time: 22 * 60, centre: lamp!, zoom: 16 })
    const day = frame({ time: 13 * 60, centre: lamp!, zoom: 16 })
    expect(night).not.toBe(day)
  })
  it('dusk, water frame 1, and tracks', () => {
    vi.spyOn(performance, 'now').mockReturnValue(500)
    const w = findWater()
    expect(frame({ time: 19 * 60 + 45, centre: w, zoom: 16 })).toMatchSnapshot()
    expect(frame({ centre: { x: 340, y: 306 }, zoom: 8 })).toMatchSnapshot()
  })
  it('far zoom town map with route, avoided street and walker', () => {
    expect(
      frame({
        centre: { x: cx, y: cy },
        zoom: 2,
        setup: (r) => {
          r.setRoute(route)
          r.setAvoided([[at(cx - 10, cy - 3), at(cx + 10, cy - 3), at(cx + 10, cy + 12)]])
          r.setQuest(quest({ x: cx + 6, y: cy + 3 }))
        },
      }),
    ).toMatchSnapshot()
    expect(frame({ centre: { x: cx, y: cy }, zoom: 0.5, time: 23 * 60 })).toMatchSnapshot()
  })
  it('detail zoom with the avoided street tape and a wide window', () => {
    expect(
      frame({
        w: 400,
        h: 300,
        centre: { x: cx, y: cy },
        zoom: 8,
        setup: (r) => r.setAvoided([[at(cx - 10, cy - 3), at(cx + 10, cy - 3)]]),
      }),
    ).toMatchSnapshot()
  })
  it('Halloween decor by day (subtle) at detail zoom', () => {
    expect(frame({ decor: true, centre: { x: cx + 5, y: cy + 3 }, zoom: 16, w: 390, h: 400 })).toMatchSnapshot()
  })
  it('Halloween decor at night: lit pumpkins, glows, hats on lamp posts', () => {
    expect(frame({ decor: true, time: 22 * 60, centre: { x: cx + 5, y: cy + 3 }, zoom: 16, w: 390, h: 400 })).toMatchSnapshot()
  })
})
