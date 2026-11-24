import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { cellOf } from '../world/cells.ts'
import { LiveWorld } from '../world/liveWorld.ts'
import { sliceToCells } from '../world/slice.ts'
import { MapRenderer } from './MapRenderer.ts'
import { P } from './palette.ts'
import { installSoftCanvas, SoftCanvas } from './testing/softCanvas.ts'

const records = sliceToCells(loadDemoOsm())
const centre = cellOf(DEMO_AREA.center)
const east = { i: centre.i, j: centre.j + 1 }

let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  vi.stubGlobal('devicePixelRatio', 1)
})
afterEach(() => {
  restore()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(recs = records.filter((r) => !(r.cell.i === east.i && r.cell.j === east.j))) {
  const lw = new LiveWorld(centre, recs)
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = 240
  canvas.clientHeight = 180
  const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, lw)
  r.setClockOverride(13 * 60)
  return { lw, canvas, r }
}

const hex = (c: string) => `${c}ff`

describe('rendering a streamed world (19.13, 19.14)', () => {
  it('draws tiles without data as the no-data ground, and the loading cells with the stipple, never black', () => {
    const { lw, canvas, r } = setup()
    const own = lw.tiles.ownedRect(east)!
    // Centre on the missing cell at detail zoom.
    r.centerOn(lw.grid.tileToLatLon(own.x + own.w / 2, own.y + own.h / 2), 8)
    r.render()
    expect(canvas.pixel(120, 90)).toBe(hex(P.groundB))
    lw.setLoading([east])
    r.render()
    const seen = new Set<string>()
    for (let y = 0; y < 180; y += 1) for (let x = 0; x < 240; x += 1) seen.add(canvas.pixel(x, y))
    expect(seen.has(hex(P.groundDot))).toBe(true)
    expect(seen.has(hex(P.groundB))).toBe(true)
    expect(seen.has('#000000ff')).toBe(false)
    r.dispose()
  })

  it('repaints only the chunks a new cell touches and never rebuilds the overview', () => {
    const { lw, r } = setup()
    const own = lw.tiles.ownedRect(east)!
    r.centerOn(lw.grid.tileToLatLon(own.x - 4, own.y + own.h / 2), 16)
    for (let k = 0; k < 30; k++) r.render()
    const before = r.chunkCount
    expect(before).toBeGreaterThan(4)
    r.zoomTo(2)
    r.render()
    r.zoomTo(1)
    r.render()
    lw.add(records.filter((rec) => rec.cell.i === east.i && rec.cell.j === east.j))
    // The chunks over the new cell (and one tile beyond it) are gone; the ones farther west stay.
    expect(r.chunkCount).toBeLessThan(before)
    expect(r.chunkCount).toBeGreaterThan(0)
    expect(r.overviewBuilds).toEqual({ town: 1, far: 1 })
    r.render()
    expect(r.overviewBuilds).toEqual({ town: 1, far: 1 })
    r.dispose()
  })

  it('tells the app where the view is after a pan, zoom or follow, once per change', () => {
    const { lw, r } = setup()
    const heard: { box: unknown; centre: { lat: number; lon: number } }[] = []
    r.onViewChange((box, c) => heard.push({ box, centre: c }))
    r.centerOn(DEMO_AREA.center, 16)
    r.render()
    r.render()
    expect(heard).toHaveLength(1)
    expect(heard[0]!.centre.lat).toBeCloseTo(DEMO_AREA.center.lat, 4)
    r.follow({ lat: DEMO_AREA.center.lat + 0.001, lon: DEMO_AREA.center.lon })
    r.render()
    expect(heard).toHaveLength(2)
    const box = r.viewBBox()
    expect(box.north).toBeGreaterThan(box.south)
    expect(lw.grid).toBe(r.grid)
    r.dispose()
  })
})
