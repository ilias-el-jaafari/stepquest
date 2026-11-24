import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer } from './MapRenderer.ts'
import { tileEdgeX, tileEdgeY, type View } from './view.ts'

/**
 * P-D3 Screen covered. For any zoom, pixel ratio, screen size and camera position, every device pixel
 * of the loaded area that is on screen is covered by a painted chunk or a stand-in, whether the frame
 * budget paints all chunks or only one (design.md, "Architecture review", B7; B16 was checked here too and not reproduced).
 */
const grid = buildTileGrid(loadDemoOsm())

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function coverageGaps(opts: { dpr: number; zoom: number; cssW: number; cssH: number; tx: number; ty: number; slow: boolean }): number {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (opts.slow ? (clock += 10) : 1000))
  vi.stubGlobal('devicePixelRatio', opts.dpr)
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: opts.cssW })
  Object.defineProperty(canvas, 'clientHeight', { value: opts.cssH })
  const rects: number[][] = []
  const scratch = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k === 'createImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: (t, k: string, v) => ((t[k] = v), true) })
  const main = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === 'drawImage' ? (...a: number[]) => { if (a.length === 9) rects.push(a.slice(5)) } : () => {}),
    set: (t, k: string, v) => ((t[k] = v), true),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return (this === canvas ? main : scratch) as never
  })
  const r = new MapRenderer(canvas, grid)
  r.zoom = opts.zoom
  r.camX = opts.tx
  r.camY = opts.ty
  r.render()
  const w = canvas.width
  const h = canvas.height
  const scale = opts.zoom * opts.dpr
  const view = { originX: Math.round(w / 2 - opts.tx * scale), originY: Math.round(h / 2 - opts.ty * scale), scale } as View
  const covered = new Uint8Array(w * h)
  for (const [dx, dy, dw, dh] of rects) for (let y = Math.max(0, dy!); y < Math.min(h, dy! + dh!); y++) for (let x = Math.max(0, dx!); x < Math.min(w, dx! + dw!); x++) covered[y * w + x] = 1
  let gaps = 0
  const x1 = Math.min(w, tileEdgeX(view, grid.cols))
  const y1 = Math.min(h, tileEdgeY(view, grid.rows))
  for (let y = Math.max(0, view.originY); y < y1; y++) for (let x = Math.max(0, view.originX); x < x1; x++) if (!covered[y * w + x]) gaps++
  r.dispose()
  return gaps
}

describe('P-D3 chunk coverage', () => {
  it('has no uncovered pixel inside the loaded area at any zoom, ratio and camera', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1, 1.1, 1.25, 1.33, 1.5, 2, 2.2, 2.625, 3),
        fc.constantFrom(8, 16, 24, 32, 48),
        fc.integer({ min: 120, max: 420 }),
        fc.integer({ min: 120, max: 420 }),
        fc.double({ min: -20, max: grid.cols + 20, noNaN: true }),
        fc.double({ min: -20, max: grid.rows + 20, noNaN: true }),
        fc.boolean(),
        (dpr, zoom, cssW, cssH, tx, ty, slow) => {
          expect(coverageGaps({ dpr, zoom, cssW, cssH, tx, ty, slow })).toBe(0)
        },
      ),
      { seed: 20261204, numRuns: 80 },
    )
  })
  it('covers a screen that straddles several chunk corners at the awkward ratio 1.33', () => {
    expect(coverageGaps({ dpr: 1.33, zoom: 8, cssW: 400, cssH: 300, tx: 32 * 9, ty: 32 * 9, slow: true })).toBe(0)
  })
})
