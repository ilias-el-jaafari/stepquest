import { describe, expect, it } from 'vitest'
import { DEFAULT_STRIDE_M } from '../geo/steps.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { createQuest } from '../quest/quest.ts'
import { planReroute } from '../quest/reroute.ts'
import { planRoute } from '../routing/planner.ts'
import { cellBBox, cellKey, cellOf } from './cells.ts'
import { LiveWorld, MAX_RESIDENT_CELLS, subtract } from './liveWorld.ts'
import { sliceToCells } from './slice.ts'
import { makeRecord } from './testing.ts'

const records = sliceToCells(loadDemoOsm())
const centre = cellOf(DEMO_AREA.center)
const east = (j: number) => j >= centre.j + 2
const westPart = records.filter((r) => !east(r.cell.j))
const eastPart = records.filter((r) => east(r.cell.j))

function questOn(world: ReturnType<LiveWorld['world']>) {
  const plan = planRoute(world.graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 4000, strideM: DEFAULT_STRIDE_M, checkpoints: 5 }, world.data.bbox)
  if (!plan.ok) throw new Error('no plan')
  const r = plan.route
  return createQuest({ mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }, { strideM: DEFAULT_STRIDE_M, area: { kind: 'demo' }, simulated: true, now: 0, id: 'q' })
}

describe('live world', () => {
  it('starts from an extract and knows which cells are still partial', () => {
    const lw = LiveWorld.fromData(loadDemoOsm())
    expect(lw.cellCount).toBe(records.length)
    expect(lw.needs(centre)).toBe(false)
    const corner = records.find((r) => r.coverage.south > cellBBox(r.cell).south)!
    expect(lw.needs(corner.cell)).toBe(true)
    expect(lw.needs({ i: centre.i + 9, j: centre.j })).toBe(false)
    lw.add([makeRecord(corner.cell, [])])
    expect(lw.needs(corner.cell)).toBe(false)
  })

  it('keeps the grid object and only grows the graph when cells arrive', () => {
    const lw = new LiveWorld(centre, westPart)
    const before = lw.world()
    const size = before.graph.size
    const lat = before.graph.lat.slice()
    lw.add(eastPart)
    const after = lw.world()
    expect(after.grid).toBe(before.grid)
    expect(after.graph.size).toBeGreaterThan(size)
    expect(before.graph.size).toBe(size)
    expect(after.graph.lat.slice(0, size)).toEqual(lat)
    expect(lw.world()).toBe(after)
  })

  it('does not change an active quest when cells arrive (19.12), and a later reroute uses the new cells', () => {
    const lw = new LiveWorld(centre, westPart)
    const first = lw.world()
    const quest = questOn(first)
    const frozen = JSON.stringify(quest)
    const routePoints = quest.route.points
    const oldGraph = first.graph
    const oldData = first.data
    const ways = oldData.ways.length

    const added = lw.add(eastPart)
    expect(added.length).toBe(eastPart.length)
    const next = lw.world()
    // The quest, its route and gems, and everything the old snapshot holds are untouched.
    expect(JSON.stringify(quest)).toBe(frozen)
    expect(quest.route.points).toBe(routePoints)
    expect(oldData.ways).toHaveLength(ways)
    expect(first.graph).toBe(oldGraph)
    expect(next.grid).toBe(first.grid)
    // The new graph reaches streets in the new cells.
    const far = { lat: 39.494, lon: -0.376 }
    expect(oldGraph.nearestNode(far)!.distance).toBeGreaterThan(300)
    expect(next.graph.nearestNode(far)!.distance).toBeLessThan(60)
    // A reroute planned on the new world works and leaves the quest object alone.
    const off = { ...quest, player: quest.route.points[3]!, alongM: 50 }
    const patch = planReroute(off, { graph: next.graph, ctx: next.safety, data: next.data, bbox: next.data.bbox }, { avoid: [], now: 0 })
    expect(patch === undefined || patch.route.points.length > 1).toBe(true)
    expect(JSON.stringify(quest)).toBe(frozen)
  })

  it('evicts far cells first, never the view or the cells along the active route (19.15)', () => {
    const lw = new LiveWorld(centre, records)
    const quest = questOn(lw.world())
    const view = [centre]
    const routeCells = new Set(quest.route.points.map((p) => cellKey(cellOf(p))))
    const dropped = lw.evict(view, quest.route.points, DEMO_AREA.center, 6)
    expect(dropped.length).toBeGreaterThan(0)
    for (const c of dropped) {
      expect(routeCells.has(cellKey(c))).toBe(false)
      expect(cellKey(c)).not.toBe(cellKey(centre))
      const r = lw.tiles.ownedRect(c)!
      expect(lw.grid.coveredAt(r.x + 1, r.y + 1)).toBe(false)
    }
    // The route still runs on the graph that is left.
    const w = lw.world()
    for (const p of quest.route.points.filter((_, k) => k % 25 === 0)) expect(w.graph.nearestNode(p)!.distance).toBeLessThan(25)
    expect(lw.evict(view, [], DEMO_AREA.center)).toEqual([])
    expect(MAX_RESIDENT_CELLS).toBe(49)
  })

  it('drops cells by least recently seen, then by distance', () => {
    const lw = new LiveWorld(centre, records)
    const keepNear = records.map((r) => r.cell).filter((c) => Math.abs(c.i - centre.i) + Math.abs(c.j - centre.j) <= 1)
    lw.touch(keepNear, 1000)
    const dropped = lw.evict([], [], DEMO_AREA.center, keepNear.length)
    expect(lw.cellCount).toBe(keepNear.length)
    for (const c of keepNear) expect(dropped.map(cellKey)).not.toContain(cellKey(c))
  })

  it('reports the loading rectangles and tells listeners when they change', () => {
    const lw = new LiveWorld(centre, westPart)
    const heard: unknown[] = []
    lw.subscribe((r) => heard.push(r))
    const missing = eastPart[0]!.cell
    lw.setLoading([missing])
    expect(lw.loading()).toEqual([lw.tiles.ownedRect(missing)])
    lw.setLoading([missing])
    expect(heard).toEqual([undefined])
    lw.setLoading([])
    expect(lw.loading()).toEqual([])
  })

  it('subtracts a rectangle into at most four pieces', () => {
    const pieces = subtract({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 3, w: 4, h: 5 })
    expect(pieces.reduce((a, r) => a + r.w * r.h, 0)).toBe(100 - 20)
    expect(subtract({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
})

describe('frontier (requirement 19.21)', () => {
  it('lists only edges that face missing data, never a border shared with a complete cell', () => {
    const a = { i: 10, j: 10 }
    const b = { i: 10, j: 11 }
    const lw = new LiveWorld(a, [makeRecord(a, []), makeRecord(b, [])])
    const own = (c: typeof a) => lw.tiles.ownedRect(c)!
    const edges = lw.frontier()
    const ra = own(a)
    const rb = own(b)
    // a (west) has no east edge: b is its loaded neighbour. b has no west edge.
    expect(edges.some((e) => e.side === 'e' && e.x === ra.x + ra.w && e.y === ra.y)).toBe(false)
    expect(edges.some((e) => e.side === 'w' && e.x === rb.x && e.y === rb.y)).toBe(false)
    // The outer sides all face missing data: 2 north, 2 south, 1 west, 1 east.
    const count = (s: string) => edges.filter((e) => e.side === s).length
    expect([count('n'), count('s'), count('w'), count('e')]).toEqual([2, 2, 1, 1])
    // A cell arriving next to them removes the edges between and adds its own.
    const c = { i: 10, j: 12 }
    lw.add([makeRecord(c, [])])
    expect(lw.frontier().filter((e) => e.side === 'e')).toHaveLength(1)
    expect(lw.frontier().filter((e) => e.side === 'e')[0]!.x).toBe(own(c).x + own(c).w)
    // Cached until the map changes.
    expect(lw.frontier()).toBe(lw.frontier())
  })

  it('every cell on the edge of a loaded rectangle gets its outer sides, whatever the order of arrival', () => {
    const cells = [0, 1, 2].flatMap((di) => [0, 1].map((dj) => ({ i: 20 + di, j: 30 + dj })))
    const sig = (order: typeof cells) => {
      const lw = new LiveWorld({ i: 21, j: 30 }, [])
      for (const c of order) lw.add([makeRecord(c, [])])
      return lw
        .frontier()
        .map((e) => `${e.side}${e.x},${e.y},${e.len}`)
        .sort()
    }
    expect(sig([...cells].reverse())).toEqual(sig(cells))
    expect(sig(cells)).toHaveLength(2 * 2 + 3 * 2)
  })
})
