import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { SAFETY_LIT } from '../osm/types.ts'
import { planLoop } from '../routing/planner.ts'
import { cellOf, cellsInBBox } from './cells.ts'
import { LiveWorld } from './liveWorld.ts'
import { sliceToCells, type CellRecord } from './slice.ts'

const M = 1 / 111_195
const HERE = { lat: 39.4697, lon: -0.3774 }
const BOX = { south: 39.46, west: -0.39, north: 39.48, east: -0.36 }

/** A square street grid (every ~110 m) over BOX, as a walking network: the shape of a record from tiles. */
function grid(source: OsmData['source'], extra: Partial<OsmWay> = {}): OsmData {
  const lat: number[] = []
  const lon: number[] = []
  const at = new Map<string, number>()
  const node = (la: number, lo: number) => {
    const k = `${la.toFixed(6)},${lo.toFixed(6)}`
    let i = at.get(k)
    if (i === undefined) {
      i = lat.length
      at.set(k, i)
      lat.push(la)
      lon.push(lo)
    }
    return i
  }
  const ways: OsmWay[] = []
  const las: number[] = []
  const los: number[] = []
  for (let v = BOX.south; v <= BOX.north + 1e-9; v += 110 * M) las.push(v)
  for (let v = BOX.west; v <= BOX.east + 1e-9; v += 140 * M) los.push(v)
  const base = { kind: 'road' as const, highway: 'residential', walkable: true, area: false, tunnel: false, crossing: false }
  for (const la of las) ways.push({ ...base, id: ways.length + 1, nodes: los.map((lo) => node(la, lo)), ...extra })
  for (const lo of los) ways.push({ ...base, id: ways.length + 1, nodes: las.map((la) => node(la, lo)), ...extra })
  return { bbox: BOX, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [], industrial: [], activity: [], source, timestamp: '' }
}

const walkRecords = (): CellRecord[] => sliceToCells(grid('tiles'), cellsInBBox(BOX), BOX)

describe('LiveWorld walking records (requirement 23)', () => {
  const demo = () => LiveWorld.fromData(loadDemoOsm())

  it('adds streets for cells outside the bundled extract, without painting or replacing anything', () => {
    const live = demo()
    const before = live.world().graph.size
    expect(live.hasGraph(cellOf(HERE))).toBe(false)
    const added = live.addWalkNet(walkRecords())
    expect(added.length).toBeGreaterThan(0)
    expect(live.hasGraph(cellOf(HERE))).toBe(true)
    expect(live.needsGraph(cellOf(HERE))).toBe(false)
    const w = live.world()
    expect(w.graph.size).toBeGreaterThan(before)
    expect(w.data.source).toBe('tiles')
    expect(live.hasAny(cellOf(HERE))).toBe(false)
  })

  it('keeps the graph record of a cell the extract already holds', () => {
    const live = demo()
    const inside = cellOf(DEMO_AREA.center)
    const rec = { ...walkRecords()[0]!, cell: inside }
    expect(live.addWalkNet([rec])).toEqual([])
  })

  it('a second call for the same cells adds nothing; ways of two loads never join by id', () => {
    const live = demo()
    live.addWalkNet(walkRecords())
    const size = live.world().graph.size
    expect(live.addWalkNet(walkRecords())).toEqual([])
    expect(live.world().graph.size).toBe(size)
  })

  it('plans a loop at the walker\'s position, on the network around it, though the bundled extract is the larger one', () => {
    const live = demo()
    live.addWalkNet(walkRecords())
    const w = live.world()
    expect(w.graph.component.some((c) => c > 0)).toBe(true)
    const r = planLoop(w.graph, { mode: 'loop', start: HERE, targetSteps: 3000, strideM: 0.75 }, w.data.bbox)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Math.abs(r.route.error)).toBeLessThanOrEqual(0.05)
  })

  it('enrichment gives the tile streets the safety flags of the Overpass ones, in a new snapshot', () => {
    const live = demo()
    const walkCells = new Set(live.addWalkNet(walkRecords()).map((c) => `${c.i},${c.j}`))
    const before = live.world()
    const lit = sliceToCells(grid('overpass', { safety: SAFETY_LIT, name: 'Calle Prueba' }), cellsInBBox(BOX), BOX).filter((r) => walkCells.has(`${r.cell.i},${r.cell.j}`))
    // Overpass cells of a cell with a walking record only enrich (the streets of `add` are not doubled).
    const sizeBefore = before.graph.size
    live.add(lit)
    const after = live.world()
    expect(after).not.toBe(before)
    expect(after.graph.size).toBe(sizeBefore)
    expect(after.data.ways.filter((w) => w.safety === SAFETY_LIT && w.name === 'Calle Prueba').length).toBeGreaterThan(10)
    expect(before.data.ways.some((w) => w.name === 'Calle Prueba')).toBe(false)
    expect(after.data.source).toBe('tiles')
  })

  it('a world with no Overpass data uses the default weights (flags 0) for every tile street', () => {
    const live = demo()
    live.addWalkNet(walkRecords())
    const w = live.world()
    const tileWays = w.data.ways.filter((x) => x.id >= 1_000_000 && x.id < 2_000_000)
    expect(tileWays.length).toBeGreaterThan(10)
    expect(tileWays.every((x) => (x.safety ?? 0) === 0)).toBe(true)
  })
})
