import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../osm/cache.ts'
import { encodeOsm } from '../osm/codec.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { normalizeOverpass } from '../osm/normalize.ts'
import { OverpassClient, type DownloadExtras, type Downloader } from '../osm/overpass.ts'
import { MapRenderer } from '../render/MapRenderer.ts'
import { installSoftCanvas, SoftCanvas } from '../render/testing/softCanvas.ts'
import { cellOf, cellsInBBox } from './cells.ts'
import { LiveWorld } from './liveWorld.ts'
import { Streamer } from './streamer.ts'

/**
 * Field benchmark (390 × 844, quest, GPS denied): zoom out to the floor, drag about three screens to
 * the north-west, wait. Before the fix the view ended up wholly outside the 9 × 9-cell frame (the
 * camera may go half a screen past it), every view cell was filtered out as "not in frame", no request
 * was planned and the map said `full` with 0 pending while the screen was blank.
 */
let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
  vi.stubGlobal('devicePixelRatio', 1)
})
afterEach(() => {
  restore()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const log: { coarse: boolean; south: number }[] = []
  const download: Downloader = async (bbox, _p, extras?: DownloadExtras) => {
    log.push({ coarse: extras?.coarse === true, south: bbox.south })
    return encodeOsm(normalizeOverpass({ elements: [] }, bbox))
  }
  const client = new OverpassClient({ cache: new MemoryCache(), download })
  const world = LiveWorld.fromData(loadDemoOsm())
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = 390
  canvas.clientHeight = 844
  let renderer = new MapRenderer(canvas as unknown as HTMLCanvasElement, world)
  const s = new Streamer({ client, world, online: () => true, reanchor: () => true, onFrame: () => undefined })
  const report = () => s.setView(renderer.viewBBox(), renderer.screenToLatLon(195, 422), renderer.zoom, renderer.horizonBBox())
  renderer.onViewChange((box, centre, zoom, horizon) => s.setView(box, centre, zoom, horizon))
  // A quest: the zoom floor applies; zoom out to it.
  renderer.setQuest({ player: undefined, accuracyM: undefined, collected: 0, alongM: 0 })
  renderer.centerOn(DEMO_AREA.center, 16)
  renderer.render()
  for (let k = 0; k < 12; k++) renderer.zoomStep(-1)
  renderer.render()
  /** Drag `screens` screens to the north-west (each drag is clamped like a real one), letting the view rest. */
  const panNorthWest = async (screens: number) => {
    for (let k = 0; k < screens * 4; k++) {
      renderer.panBy(390 / 4, 844 / 4)
      renderer.render()
    }
  }
  const rebuild = () => {
    // What MapView does when the frame moves: a new renderer on the new grid, same place and zoom.
    const at = renderer.screenToLatLon(195, 422)
    const zoom = renderer.zoom
    renderer.dispose()
    renderer = new MapRenderer(canvas as unknown as HTMLCanvasElement, world)
    renderer.onViewChange((box, centre, z, horizon) => s.setView(box, centre, z, horizon))
    renderer.setQuest({ player: undefined, accuracyM: undefined, collected: 0, alongM: 0 })
    renderer.centerOn(at, zoom)
    renderer.render()
  }
  return { log, world, s, renderer: () => renderer, panNorthWest, rebuild, report }
}

describe('pan away during a quest, at the zoom floor (field benchmark)', () => {
  it('plans coarse first and detail where the zoom allows for what the camera shows, re-anchoring the frame, and reports the visible view', async () => {
    const { log, world, s, renderer, panNorthWest, rebuild } = setup()
    const startFrame = world.grid.bbox
    await panNorthWest(3)
    const view = renderer().viewBBox()
    // The camera really is off the old frame (the reproduction of the field run).
    expect(view.east < startFrame.west || view.south > startFrame.north || cellsInBBox(view).every((c) => !world.inFrame(c))).toBe(true)
    // While the view is off the data, the map must not claim to be ready.
    expect(s.status().ready).not.toBe('full')
    expect(s.status().pending).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1000)
    // The frame moved to the view (MapView rebuilds its renderer on the new grid).
    expect(world.grid.bbox).not.toEqual(startFrame)
    rebuild()
    const shown = cellsInBBox(renderer().viewBBox())
    expect(shown.every((c) => world.inFrame(c))).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    // Requests were planned for the new place: coarse first.
    expect(log.length).toBeGreaterThan(0)
    expect(log[0]!.coarse).toBe(true)
    expect(log.some((l) => l.south > startFrame.north - 0.05)).toBe(true)
    // Everything on screen has what the zoom needs, and readiness says so for the visible cells.
    for (const c of shown) expect(world.hasAny(c)).toBe(true)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('then zooming in on the new place asks for detail there', async () => {
    const { log, world, s, renderer, panNorthWest, rebuild } = setup()
    await panNorthWest(3)
    await vi.advanceTimersByTimeAsync(1000)
    rebuild()
    await vi.advanceTimersByTimeAsync(60_000)
    renderer().zoomTo(16)
    renderer().render()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const centre = cellOf(renderer().screenToLatLon(195, 422))
    expect(world.needs(centre)).toBe(false)
    expect(log.some((l) => !l.coarse)).toBe(true)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('keeps the quest data: the route cells stay in the walking graph after the frame moves', async () => {
    const { world, panNorthWest } = setup()
    const before = world.world()
    await panNorthWest(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(world.frameVersion).toBe(1)
    const after = world.world()
    expect(after.grid).not.toBe(before.grid)
    expect(after.data.ways.length).toBeGreaterThanOrEqual(before.data.ways.length)
    // The walking graph of the demo (where the walker stands) is the same size: a reroute still works.
    expect(after.graph.size).toBe(before.graph.size)
    expect(after.graph.edgeCount).toBe(before.graph.edgeCount)
  })
})
