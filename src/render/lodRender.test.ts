import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { LodLayer } from '../lod/layer.ts'
import { LodStore } from '../lod/store.ts'
import { tilesWithin } from '../lod/select.ts'
import { makeLod } from '../lod/testing.ts'
import { MapRenderer } from './MapRenderer.ts'

/** The renderer with a LOD layer (requirement 25): the layer draws inside the cached scene, and a bitmap that arrives redraws it once. */
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

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 2)
  vi.spyOn(performance, 'now').mockImplementation(() => 1000)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(zoom: number) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 390 })
  Object.defineProperty(canvas, 'clientHeight', { value: 700 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stub() as never)
  const r = new MapRenderer(canvas, grid)
  r.setClockOverride(13 * 60)
  const centre = at(grid.cols / 2, grid.rows / 2)
  const jobs: (() => void)[] = []
  const store = new LodStore({
    later: (fn) => jobs.push(fn),
    canvas: (size) => ({ canvas: { width: size, height: size } as unknown as HTMLCanvasElement, ctx: stub() as unknown as CanvasRenderingContext2D }),
  })
  const layer = new LodLayer(store, 9_000)
  layer.setHero(centre)
  r.setLod(layer)
  r.centerOn(centre, zoom)
  for (let i = 0; i < 40; i++) r.render()
  return { r, store, layer, centre, jobs }
}

describe('renderer with the LOD layer', () => {
  it('asks the layer for the far view once per scene, and a bitmap that arrives redraws the scene once, then nothing more', () => {
    const { r, store, layer, centre, jobs } = setup(0.5)
    const draw = vi.spyOn(layer, 'drawBlocks')
    const labels = vi.spyOn(layer, 'drawLabels')
    for (let i = 0; i < 20; i++) r.render()
    expect(draw).not.toHaveBeenCalled()
    for (const t of tilesWithin(centre, 3_000)) store.put(makeLod(t.id, { lines: [{ cls: 'minor', pts: [[0, 2048], [4096, 2048]] }] }))
    const before = r.stats.sceneDraws
    r.render()
    expect(r.stats.sceneDraws - before).toBe(1)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(labels).toHaveBeenCalledTimes(1)
    // The painting jobs run one slice per task; each finished bitmap marks the scene dirty.
    let guard = 0
    while (jobs.length && guard++ < 5_000) {
      jobs.shift()!()
      r.render()
    }
    expect(store.stats.bitmapsDone).toBeGreaterThan(0)
    const settled = r.stats.sceneDraws
    for (let i = 0; i < 30; i++) r.render()
    expect(r.stats.sceneDraws).toBe(settled)
    r.dispose()
  })

  it('does not draw the LOD look above FAR_ZOOM, but still names streets until DETAIL_ZOOM', () => {
    const { r, layer } = setup(4)
    const draw = vi.spyOn(layer, 'drawBlocks')
    const labels = vi.spyOn(layer, 'drawLabels')
    r.centerOn(r.screenToLatLon(r.cssWidth / 2, r.cssHeight / 2), 4.5)
    r.render()
    expect(draw).not.toHaveBeenCalled()
    expect(labels).toHaveBeenCalled()
    r.dispose()
  })

  it('stops listening to the layer when it is taken away or the renderer is disposed', () => {
    const { r, store, centre, layer } = setup(0.5)
    r.setLod(undefined)
    const before = r.stats.sceneDraws
    for (const t of tilesWithin(centre, 1_000)) store.put(makeLod(t.id, {}))
    for (let i = 0; i < 5; i++) r.render()
    expect(r.stats.sceneDraws - before).toBeLessThanOrEqual(1)
    r.setLod(layer)
    r.dispose()
  })
})
