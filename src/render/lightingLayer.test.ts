import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { MapRenderer } from './MapRenderer.ts'
import { installSoftCanvas, SoftCanvas } from './testing/softCanvas.ts'

const grid = buildTileGrid(loadDemoOsm())

let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  vi.spyOn(performance, 'now').mockReturnValue(1000)
})
afterEach(() => {
  restore()
  vi.restoreAllMocks()
})

function mean(c: SoftCanvas): [number, number, number] {
  const s = [0, 0, 0]
  for (let i = 0; i < c.data.length; i += 4) for (let k = 0; k < 3; k++) s[k]! += c.data[i + k]!
  const n = c.data.length / 4
  return [s[0]! / n, s[1]! / n, s[2]! / n]
}

describe('P-L5 the painted frame follows the clock continuously', () => {
  it('the average colour of a frame changes by under 5.1 levels (0.02 of 255, as P-L3 allows) per minute from 15:00 to 23:30', () => {
    const canvas = new SoftCanvas(10, 10)
    canvas.clientWidth = 120
    canvas.clientHeight = 90
    const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, grid)
    r.centerOn(grid.tileToLatLon(300, 300), 8)
    let prev: [number, number, number] | undefined
    let worst = 0
    for (let minute = 15 * 60; minute <= 23 * 60 + 30; minute += 1) {
      r.setClockOverride(minute)
      r.render()
      const m = mean(canvas)
      if (prev) worst = Math.max(worst, ...m.map((v, k) => Math.abs(v - prev![k]!)))
      prev = m
    }
    r.dispose()
    expect(worst).toBeLessThan(5.1)
  })

  it('night is darker than noon and the chunk cache is the same at both times', () => {
    const canvas = new SoftCanvas(10, 10)
    canvas.clientWidth = 120
    canvas.clientHeight = 90
    const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, grid)
    r.centerOn(grid.tileToLatLon(300, 300), 8)
    r.setClockOverride(13 * 60)
    for (let i = 0; i < 12; i++) r.render() // the screen and its prefetch ring
    const day = mean(canvas)
    const chunks = r.chunkCount
    r.setClockOverride(2 * 60)
    for (let i = 0; i < 3; i++) r.render()
    const night = mean(canvas)
    expect(night[0]! + night[1]! + night[2]!).toBeLessThan((day[0]! + day[1]! + day[2]!) * 0.8)
    expect(r.chunkCount).toBe(chunks)
    r.dispose()
  })
})
