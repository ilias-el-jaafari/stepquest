import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer } from './MapRenderer.ts'

const grid = buildTileGrid(loadDemoOsm())

/** A canvas context that records the composite modes and fill colours used. */
function recorder() {
  const log = { composites: new Set<string>(), fills: new Set<string>(), glows: 0 }
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get: (t, k: string) => {
      if (k in t) return t[k]
      if (k === 'drawImage') return () => void log.glows++
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

function renderAt(time: number | undefined) {
  const { ctx, log } = recorder()
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 400 })
  Object.defineProperty(canvas, 'clientHeight', { value: 400 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  const r = new MapRenderer(canvas, grid)
  r.setClockOverride(time)
  r.centerOn({ lat: 39.4935, lon: -0.392 }, 16)
  r.render()
  const lighting = r.lighting
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
})
