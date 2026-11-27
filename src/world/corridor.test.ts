import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { planWithSafety } from '../routing/safePlanner.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { tileBBox, tileKey, type TileId } from '../vector/tileMath.ts'
import { cellOf } from './cells.ts'
import { CORRIDOR_FROM_M, CORRIDOR_MAX_HALF_M, CORRIDOR_MIN_HALF_M, corridorCells, corridorHalfM, corridorTiles, isCorridor } from './corridor.ts'
import { LiveWorld } from './liveWorld.ts'
import { loadWalkRecords, walkTiles } from './walkArea.ts'

/** València, and a finish 9 km to the north-west (routing requirement 14). */
const START: LatLon = { lat: 39.4697, lon: -0.3774 }
const END = destination(START, 315, 9_000)
const STRIDE = 0.75

describe('corridor of a long A → B walk (routing requirement 14)', () => {
  it('only walks longer than 4 km (straight) use the corridor', () => {
    expect(isCorridor(START, undefined)).toBe(false)
    expect(isCorridor(START, destination(START, 90, CORRIDOR_FROM_M - 50))).toBe(false)
    expect(isCorridor(START, destination(START, 90, CORRIDOR_FROM_M + 50))).toBe(true)
  })

  it('the half width grows with the goal, between 1 and 2 km', () => {
    expect(corridorHalfM(9_000, 9_000)).toBe(CORRIDOR_MIN_HALF_M)
    expect(corridorHalfM(9_000, 40_000)).toBe(CORRIDOR_MAX_HALF_M)
    const mid = corridorHalfM(9_000, 15_000)
    expect(mid).toBeGreaterThanOrEqual(CORRIDOR_MIN_HALF_M)
    expect(mid).toBeLessThanOrEqual(CORRIDOR_MAX_HALF_M)
  })

  it('a 9 km walk loads a band of about 40 cells and 25 vector tiles, not the 70 cells of the box around it', () => {
    const target = stepsToMetres(14_000, STRIDE)
    const cells = corridorCells(START, END, target)
    const tiles = corridorTiles(START, END, target)
    expect(haversine(START, END)).toBeGreaterThan(8_950)
    expect(cells.length).toBeGreaterThanOrEqual(30)
    expect(cells.length).toBeLessThanOrEqual(60)
    expect(tiles.length).toBeGreaterThanOrEqual(18)
    expect(tiles.length).toBeLessThanOrEqual(36)
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length)
    // Start and finish cells are in it.
    expect(cells.some((c) => c.i === cellOf(START).i && c.j === cellOf(START).j)).toBe(true)
    expect(cells.some((c) => c.i === cellOf(END).i && c.j === cellOf(END).j)).toBe(true)
  })

  it('every point of the straight line, and 700 m either side of it, lies in a corridor cell', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -700, max: 700, noNaN: true }), (f, side) => {
        const cells = new Set(corridorCells(START, END, stepsToMetres(14_000, STRIDE)).map((c) => `${c.i},${c.j}`))
        const along = { lat: START.lat + (END.lat - START.lat) * f, lon: START.lon + (END.lon - START.lon) * f }
        const p = destination(along, 45, side)
        const c = cellOf(p)
        expect(cells.has(`${c.i},${c.j}`)).toBe(true)
      }),
      { numRuns: 200, seed: 14 },
    )
  })

  it('contains the finish itself: its cell and every tile within the snap reach of it, from 4 to 10 km, in any direction and for any goal (requirement 14.5)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359 }), fc.integer({ min: 4_100, max: 10_000 }), fc.integer({ min: 4_000, max: 40_000 }), fc.integer({ min: 0, max: 359 }), (bearing, distance, goal, around) => {
        const end = destination(START, bearing, distance)
        const cells = corridorCells(START, end, goal)
        const here = cellOf(end)
        expect(cells.some((c) => c.i === here.i && c.j === here.j)).toBe(true)
        const tiles = new Set(corridorTiles(START, end, goal).map(tileKey))
        // A snapped finish lies at most 250 m from the tap (map-rendering 26.7): the tile it is in is loaded.
        const snapped = destination(end, around, 250)
        const tile = walkTiles([cellOf(snapped)]).map(tileKey)
        const own = tile.filter((k) => tiles.has(k))
        expect(own.length).toBeGreaterThan(0)
      }),
      { numRuns: 60 },
    )
  })

  it('works in any direction and keeps the tile count in step with the length', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 4_100, max: 12_000, noNaN: true }), (bearing, dist) => {
        const end = destination(START, bearing, dist)
        const tiles = corridorTiles(START, end, haversine(START, end) * 1.2)
        // About one tile per 400 m of line, at least one per 2 km (tiles are 1.9 km, the band 2 to 4 km wide).
        expect(tiles.length).toBeGreaterThanOrEqual(Math.floor(dist / 2_000))
        expect(tiles.length).toBeLessThanOrEqual(Math.ceil(dist / 250) + 12)
      }),
      { numRuns: 60, seed: 3 },
    )
  })
})

/** One z14 tile of a synthetic city: a street every 0.001° of latitude and 0.0013° of longitude, with a vertex at every crossing. */
function syntheticTile(t: TileId): OsmData {
  const b = tileBBox(t)
  const lat: number[] = []
  const lon: number[] = []
  const at = new Map<string, number>()
  const node = (la: number, lo: number) => {
    const k = `${la},${lo}`
    let i = at.get(k)
    if (i === undefined) {
      i = lat.length
      at.set(k, i)
      lat.push(la)
      lon.push(lo)
    }
    return i
  }
  const las: number[] = []
  const los: number[] = []
  for (let k = Math.ceil(b.south / 0.001); k * 0.001 < b.north; k++) las.push(k * 0.001)
  for (let k = Math.ceil(b.west / 0.0013); k * 0.0013 < b.east; k++) los.push(k * 0.0013)
  const base = { kind: 'road' as const, highway: 'residential', walkable: true, area: false, tunnel: false, crossing: false }
  const ways: OsmWay[] = []
  // Each street runs from one tile edge to the other, so neighbouring tiles meet on the edge (the walking network joins the halves).
  for (const la of las) ways.push({ ...base, id: ways.length + 1, nodes: [node(la, b.west), ...los.map((lo) => node(la, lo)), node(la, b.east)] })
  for (const lo of los) ways.push({ ...base, id: ways.length + 1, nodes: [node(b.south, lo), ...las.map((la) => node(la, lo)), node(b.north, lo)] })
  return { bbox: b, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [], industrial: [], activity: [], source: 'tiles', timestamp: '' }
}

describe('planning across a synthetic 9 km city of many tiles', () => {
  // The streets are a square grid, so a walk to the north-west is about 1.4 times the straight line: 17,000 steps (12.75 km).
  const STEPS = 17_000
  const target = stepsToMetres(STEPS, STRIDE)

  it('loads only the corridor tiles, then plans the walk within ±5 %', async () => {
    const cells = corridorCells(START, END, target)
    const asked: string[] = []
    const progress: number[] = []
    const records = await loadWalkRecords(
      cells,
      {
        loadTile: async (t) => {
          asked.push(tileKey(t))
          return syntheticTile(t)
        },
      },
      { onProgress: (p) => progress.push(p.total) },
    )
    const need = walkTiles(cells).map(tileKey).sort()
    expect([...asked].sort()).toEqual(need)
    expect(new Set(progress)).toEqual(new Set([need.length]))
    expect(records.length).toBe(cells.length)

    // The world's frame is around the start; most of the corridor lies outside it, and its streets are kept (never painted).
    const live = new LiveWorld(cellOf(START), [])
    const added = live.addWalkNet(records)
    expect(added.length).toBe(cells.length)
    expect(cells.some((c) => !live.inFrame(c))).toBe(true)
    expect(cells.every((c) => live.hasGraph(c))).toBe(true)

    const w = live.world()
    const out = planWithSafety(w.graph, w.safety, { mode: 'oneway', start: START, end: END, targetSteps: STEPS, strideM: STRIDE, seed: 0 }, w.data.bbox, { safe: true, night: false, avoid: [] })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) return
    expect(Math.abs(out.result.route.distanceM - target) / target).toBeLessThanOrEqual(0.05)
    // It really crosses the city: the route's end is within a street of the finish.
    const last = out.result.route.points[out.result.route.points.length - 1]!
    expect(haversine(last, END)).toBeLessThan(150)
  })

  it('without the middle of the corridor the same plan finds no route (the streets must be loaded along the way)', async () => {
    const cells = corridorCells(START, END, target)
    const ends = [cells[0]!, cells[cells.length - 1]!]
    const records = await loadWalkRecords(ends, { loadTile: async (t) => syntheticTile(t) })
    const live = new LiveWorld(cellOf(START), [])
    live.addWalkNet(records)
    const w = live.world()
    const out = planWithSafety(w.graph, w.safety, { mode: 'oneway', start: START, end: END, targetSteps: STEPS, strideM: STRIDE, seed: 0 }, w.data.bbox, { safe: true, night: false, avoid: [] })
    expect(out.result.ok).toBe(false)
  })
})
