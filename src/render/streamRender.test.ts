import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { cellOf, cellsInBBox } from '../world/cells.ts'
import { LiveWorld } from '../world/liveWorld.ts'
import { sliceToCells } from '../world/slice.ts'
import { COARSE_Z } from '../vector/assemble.ts'
import { tilesInBBox } from '../vector/tileMath.ts'
import { FRAME_CELLS, QUEST_WINDOW_TILES } from '../world/window.ts'
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

  it('keeps a quest view coverable: no zoom path goes below the floor, the planner is not limited', () => {
    // A desktop window: the phone of the field check has no floor any more (the coarse tiles cover its furthest view).
    const { canvas, r } = setup()
    canvas.clientWidth = 1280
    canvas.clientHeight = 800
    r.centerOn(DEMO_AREA.center, 16)
    r.zoomTo(0.5)
    r.render()
    expect(r.zoom).toBe(0.5)
    r.setQuest({ player: undefined, accuracyM: undefined, collected: 0, alongM: 0 })
    r.render()
    const floor = r.minZoom
    expect(floor).toBeGreaterThan(0.5)
    expect(r.zoom).toBe(floor)
    r.zoomTo(0.5)
    r.zoomStep(-1)
    r.render()
    expect(r.zoom).toBe(floor)
    // The view at the floor fits the frame and touches no more coarse tiles than the budget.
    const fits = () => {
      const cells = cellsInBBox(r.viewBBox())
      expect(new Set(cells.map((c) => c.j)).size).toBeLessThanOrEqual(FRAME_CELLS)
      expect(new Set(cells.map((c) => c.i)).size).toBeLessThanOrEqual(FRAME_CELLS)
      expect(tilesInBBox(r.viewBBox(), COARSE_Z).length).toBeLessThanOrEqual(QUEST_WINDOW_TILES)
    }
    fits()
    // Rotation keeps it so.
    canvas.clientWidth = 800
    canvas.clientHeight = 1280
    r.render()
    fits()
    r.setQuest(undefined)
    r.render()
    expect(r.minZoom).toBe(0)
    r.zoomTo(0.5)
    expect(r.zoom).toBe(0.5)
    r.dispose()
  })

  it('fades the frontier: no straight cut where data stops, and only no-data ground colours', () => {
    const { lw, canvas, r } = setup()
    const own = lw.tiles.ownedRect(centre)!
    // Detail zoom on the loaded cell's east border (the east cell is missing): the border is a frontier.
    r.centerOn(lw.grid.tileToLatLon(own.x + own.w - 2, own.y + own.h / 2), 8)
    r.render()
    const edge = Math.round(120 + (2 * 8))
    const column = (x: number) => Array.from({ length: 180 }, (_, y) => canvas.pixel(x, y))
    // Right of the edge: plain ground, one colour.
    expect(new Set(column(edge + 6))).toEqual(new Set([hex(P.groundB)]))
    // Left of the edge, inside the fog band: a mix of ground and map, so the cut is broken up.
    expect(new Set(column(edge - 3)).has(hex(P.groundB))).toBe(true)
    expect(new Set(column(edge - 3)).size).toBeGreaterThan(1)
    // Far inside the band's reach the map is untouched by fog.
    const far = new Set<string>()
    for (let x = edge - 90; x < edge - 70; x++) for (let y = 0; y < 180; y++) far.add(canvas.pixel(x, y))
    expect(far.size).toBeGreaterThan(2)
    r.dispose()
  })
})
