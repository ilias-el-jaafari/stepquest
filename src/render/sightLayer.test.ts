import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { SIGHT_KINDS, type SightMark } from '../sights/types.ts'
import { Terrain } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { CHUNK } from './chunkLayer.ts'
import { chunkKey } from './chunkPlan.ts'
import type { Lighting } from './daylight.ts'
import { SightLayer } from './sightLayer.ts'
import type { View } from './view.ts'

const grid = buildTileGrid(loadDemoOsm())
const painted = new Set<number>()
for (let cy = 0; cy <= Math.ceil(grid.rows / CHUNK); cy++) for (let cx = 0; cx <= Math.ceil(grid.cols / CHUNK); cx++) painted.add(chunkKey(cx, cy))
const view = (zoom: number): View => ({ w: 6000, h: 6000, dpr: 1, zoom, cssW: 6000, cssH: 6000, scale: zoom, originX: 0, originY: 0, camX: 0, camY: 0, detail: zoom >= 8 })
const NIGHT: Lighting = { altitude: -20, phase: 'night', tint: [84, 92, 156], darkness: 0.7, lamps: 1, windows: 1 }

function marks(n: number): SightMark[] {
  const out: SightMark[] = []
  for (let y = 10; y < grid.rows - 10 && out.length < n; y += 9) {
    for (let x = 10; x < grid.cols - 10 && out.length < n; x += 9) {
      if (grid.terrain[y * grid.cols + x] === Terrain.road) continue
      const p = grid.tileToLatLon(x + 0.5, y + 0.5)
      out.push({ id: `m${out.length}`, kind: SIGHT_KINDS[out.length % SIGHT_KINDS.length]!, lat: p.lat, lon: p.lon, name: `Place number ${out.length}`, alongM: out.length, lateralM: 5 })
    }
  }
  return out
}

function recorder() {
  const calls = { drawImage: 0, fillText: 0, strokeText: 0 }
  const ctx = {
    drawImage: () => calls.drawImage++,
    fillText: () => calls.fillText++,
    strokeText: () => calls.strokeText++,
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, lineJoin: 'miter', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('SightLayer', () => {
  it('draws one sprite per standing sight into the scene, and nothing without marks', () => {
    const layer = new SightLayer(grid)
    const { ctx, calls } = recorder()
    layer.drawStatic(ctx, view(24), painted)
    expect(calls.drawImage).toBe(0)
    expect(layer.setMarks(marks(8))).toBe(true)
    layer.drawStatic(ctx, view(24), painted)
    expect(layer.standing.length).toBeGreaterThan(3)
    expect(calls.drawImage).toBe(layer.stats.drawn)
    expect(layer.stats.drawn).toBe(layer.standing.length)
  })

  it('hides sights in the overview and names them only at quest zoom', () => {
    const layer = new SightLayer(grid)
    layer.setMarks(marks(8))
    const far = recorder()
    layer.drawStatic(far.ctx, view(4), painted)
    layer.drawLabels(far.ctx, view(4), painted)
    expect(far.calls.drawImage + far.calls.fillText).toBe(0)
    const mid = recorder()
    layer.drawStatic(mid.ctx, view(12), painted)
    layer.drawLabels(mid.ctx, view(12), painted)
    expect(mid.calls.drawImage).toBeGreaterThan(0)
    expect(mid.calls.fillText).toBe(0)
    const near = recorder()
    layer.drawLabels(near.ctx, view(24), painted)
    expect(near.calls.fillText).toBe(layer.standing.length)
  })

  it('lights windows and glows only when dark', () => {
    const layer = new SightLayer(grid)
    layer.setMarks(marks(8))
    const day = recorder()
    layer.drawNight(day.ctx, view(24), { ...NIGHT, darkness: 0 }, painted)
    expect(day.calls.drawImage).toBe(0)
    const night = recorder()
    layer.drawNight(night.ctx, view(24), NIGHT, painted)
    expect(night.calls.drawImage).toBe(layer.stats.lit * 2)
    expect(layer.stats.lit).toBeGreaterThan(0)
  })

  it('places once until the marks, the keep-out set or the map change', () => {
    const layer = new SightLayer(grid)
    layer.setMarks(marks(5))
    const a = layer.standing
    expect(layer.standing).toBe(a)
    expect(layer.setMarks(marks(5))).toBe(false)
    layer.invalidate()
    expect(layer.standing).not.toBe(a)
  })

  it('draws nothing for sights whose chunk is not painted', () => {
    const layer = new SightLayer(grid)
    layer.setMarks(marks(5))
    const { ctx, calls } = recorder()
    layer.drawStatic(ctx, view(24), new Set())
    expect(calls.drawImage).toBe(0)
  })
})
