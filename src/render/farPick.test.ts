import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { PAN_REACH_M, R_FAR_M } from '../lod/config.ts'
import type { TileSource } from '../vector/client.ts'
import { emptyTile } from '../vector/testing.ts'
import { cellOf } from '../world/cells.ts'
import { LiveWorld } from '../world/liveWorld.ts'
import { Streamer } from '../world/streamer.ts'
import { MapRenderer } from './MapRenderer.ts'
import { installSoftCanvas, SoftCanvas } from './testing/softCanvas.ts'

/**
 * The far pick (map-rendering requirement 26): in the planner and in a quest the camera is not tied to the streamed frame, it can be
 * 10 km from the hero, and the frame follows it.
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

const HERO: LatLon = DEMO_AREA.center

function setup(opts: { quest?: boolean; reach?: boolean } = {}) {
  const requested: string[] = []
  const tiles: TileSource = {
    busy: false,
    cachedTile: async () => undefined,
    loadTile: async (t) => {
      requested.push(`${t.z}/${t.x}/${t.y}`)
      return emptyTile(t)
    },
  }
  const world = LiveWorld.fromData(loadDemoOsm())
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = 390
  canvas.clientHeight = 844
  let renderer = new MapRenderer(canvas as unknown as HTMLCanvasElement, world)
  const s = new Streamer({ tiles, world, online: () => true, reanchor: () => true })
  const wire = (r: MapRenderer) => {
    r.onViewChange((box, centre, zoom) => s.setView(box, centre, zoom))
    if (opts.quest) r.setQuest({ player: undefined, accuracyM: undefined, collected: 0, alongM: 0 })
    if (opts.reach !== false) r.setReach(HERO, PAN_REACH_M)
  }
  wire(renderer)
  renderer.centerOn(HERO, 0.5)
  renderer.render()
  /** What MapView does when the frame moves: a new renderer on the new grid, same place and zoom. */
  const rebuild = () => {
    const at = renderer.screenToLatLon(195, 422)
    const zoom = renderer.zoom
    renderer.dispose()
    renderer = new MapRenderer(canvas as unknown as HTMLCanvasElement, world)
    wire(renderer)
    renderer.centerOn(at, zoom)
    renderer.render()
  }
  /** Drag the map so the camera moves `m` metres east (zoom 0.5: a CSS px is 10 m), in steps of about a screen. */
  const panEast = (m: number) => {
    const px = m / 10
    for (let done = 0; done < px; done += 300) {
      renderer.panBy(-Math.min(300, px - done), 0)
      renderer.render()
    }
  }
  const centre = () => renderer.screenToLatLon(195, 422)
  return { requested, world, s, renderer: () => renderer, panEast, rebuild, centre }
}

describe('the camera is not clamped to the frame (requirement 26.1)', () => {
  it.each([{ quest: false }, { quest: true }])('can be 10 km from the hero and farther, up to the reach (quest: $quest)', ({ quest }) => {
    const { renderer, panEast, centre } = setup({ quest })
    panEast(R_FAR_M)
    const d = haversine(HERO, centre())
    expect(d).toBeGreaterThan(R_FAR_M - 60)
    expect(d).toBeLessThan(R_FAR_M + 60)
    // The frame is 9 cells (about 8 km wide): without the reach, the clamp stops the camera well before 10 km.
    panEast(5_000)
    expect(haversine(HERO, centre())).toBeLessThanOrEqual(PAN_REACH_M + 60)
    expect(haversine(HERO, centre())).toBeGreaterThan(PAN_REACH_M - 60)
    renderer().dispose()
  })

  it('stays clamped near the frame when there is no reach (a map that does not follow the view)', () => {
    const { renderer, panEast, centre } = setup({ reach: false })
    panEast(R_FAR_M)
    expect(haversine(HERO, centre())).toBeLessThan(R_FAR_M - 1_000)
    renderer().dispose()
  })

  it('can go 10 km in any direction and still draws a frame', () => {
    const { renderer } = setup()
    for (const bearing of [0, 90, 180, 270, 45, 225]) {
      const r = renderer()
      r.centerOn(destination(HERO, bearing, R_FAR_M), 0.5)
      r.panBy(0, 0)
      r.render()
      expect(haversine(HERO, r.screenToLatLon(195, 422))).toBeGreaterThan(R_FAR_M - 60)
    }
  })
})

describe('the streamed frame follows the view (requirement 26.2)', () => {
  it('re-centres on a view that rests 10 km away, without moving the hero, then draws it in full', async () => {
    const { requested, world, s, renderer, panEast, rebuild, centre } = setup()
    const first = world.anchor
    panEast(R_FAR_M)
    const away = cellOf(centre())
    expect(world.inFrame(away)).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(world.frameVersion).toBe(1)
    expect(world.inFrame(away)).toBe(true)
    expect(world.anchor).not.toEqual(first)
    rebuild()
    // The camera is still where the player left it, 10 km from the hero.
    expect(haversine(HERO, centre())).toBeGreaterThan(R_FAR_M - 80)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(requested.length).toBeGreaterThan(0)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
    renderer().dispose()
  })

  it('does not move the frame while the view is still moving (it waits for the view to rest)', async () => {
    const { world, s, panEast } = setup()
    panEast(R_FAR_M)
    await vi.advanceTimersByTimeAsync(100)
    expect(world.frameVersion).toBe(0)
    s.dispose()
  })
})
