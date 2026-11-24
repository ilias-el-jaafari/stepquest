import { describe, expect, it } from 'vitest'
import { haversine } from '../geo/geo.ts'
import { metresToSteps } from '../geo/steps.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import { WalkGraph } from '../routing/graph.ts'
import { planRoute } from '../routing/planner.ts'
import { edgeCosts, safetyContext } from '../routing/safety.ts'
import { routeCells, smoothPolyline } from '../render/routePath.ts'
import { TileGrid } from '../tiles/grid.ts'
import { trackFor } from './quest.ts'
import { planReroute, rerouteQuest } from './reroute.ts'
import { offRouteQuest } from './testWalk.testutil.ts'
import type { QuestRoute } from './types.ts'

const NOW = Date.UTC(2026, 10, 22, 12)

function ms<T>(f: () => T): [T, number] {
  const t = performance.now()
  const v = f()
  return [v, performance.now() - t]
}

/** Median of a few runs, so one GC pause does not decide. */
function med(f: () => unknown, runs = 5): number {
  const t: number[] = []
  for (let i = 0; i < runs; i++) t.push(ms(f)[1])
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

describe('reroute timing on the Benicalap map', () => {
  it('shows where the time goes and stays within a budget', () => {
    const data = loadDemoOsm()
    const [graph, buildMs] = ms(() => new WalkGraph(data))
    const [ctx, ctxMs] = ms(() => safetyContext(graph, data))
    const world = { graph, ctx, data, bbox: DEMO_AREA.bbox }
    const planned = planRoute(graph, { mode: 'loop', start: DEMO_AREA.defaultStart, targetSteps: 10_000, strideM: 0.75, seed: 1 }, DEMO_AREA.bbox)
    if (!planned.ok) throw new Error('route')
    const r = planned.route
    const route: QuestRoute = { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }

    const rows: Record<string, string> = {}
    const q0 = offRouteQuest(route, 1800)
    expect(q0.offRoute).toBe(true)
    const here = q0.player!
    let n = 0
    // A new avoid list each time defeats the cache, so this is the cost of a real computation.
    const costsMs = med(() => edgeCosts(ctx, { safe: true, night: false, avoid: [`street ${n++}`] }))
    const costs = edgeCosts(ctx, { safe: true, night: false, avoid: [] })!
    const a = graph.nearestNode(here)!.node
    const b = graph.nearestNode(route.checkpoints[q0.collected]!.point)!.node
    rows['graph build (once per map)'] = buildMs.toFixed(1)
    rows['safety context (once per map)'] = ctxMs.toFixed(1)
    rows['nearest node (1 call)'] = med(() => graph.nearestNode(here)).toFixed(2)
    rows['edge costs (uncached call)'] = costsMs.toFixed(1)
    rows['A* to the next gem (1 leg)'] = med(() => graph.shortestPath(a, b, costs.cost, costs.min)).toFixed(2)

    // Several deviations along the loop: first (cold) call and median of the next ones, local vs full replan.
    const local: number[] = []
    const full: number[] = []
    const kinds: string[] = []
    let legs = 0
    const original = graph.shortestPath.bind(graph)
    graph.shortestPath = (...args) => (legs++, original(...args))
    for (const walkM of [600, 1500, 2500, 3500, 5000, 6500]) {
      const q = offRouteQuest(route, walkM)
      if (!q.offRoute) continue
      legs = 0
      const [fullPatch, fullMs] = ms(() => planReroute(q, world, { avoid: [], now: NOW, local: false }))
      const fullLegs = legs
      legs = 0
      const [patch, localMs] = ms(() => planReroute(q, world, { avoid: [], now: NOW }))
      if (patch) {
        local.push(localMs)
        kinds.push(`${walkM}m:${patch.kind}(${legs} legs)`)
        if (patch.kind === 'full') expect(localMs).toBeLessThan(250)
      }
      if (fullPatch) full.push(fullMs)
      expect(fullLegs).toBeGreaterThan(0)
    }
    graph.shortestPath = original
    const stat = (v: number[]) => (v.length ? `median ${v.sort((x, y) => x - y)[Math.floor(v.length / 2)]!.toFixed(1)}, max ${Math.max(...v).toFixed(1)} (${v.length} cases)` : 'none')
    rows['full replan only'] = stat(full)
    rows['reroute (local first)'] = stat(local)
    rows['outcomes'] = kinds.join(', ')

    const q = offRouteQuest(route, 1800)
    const next = rerouteQuest(q, world, { avoid: [], now: NOW }) ?? q
    const track = trackFor(next.route)
    const grid = new TileGrid(data.bbox)
    rows['track + route cells for drawing'] = med(() => {
      const t = trackFor({ ...next.route, points: [...next.route.points] })
      const cells = routeCells(t.points.map((p) => grid.toTileXY(p)), cumulativeDistances(track.points))
      smoothPolyline(cells)
    }).toFixed(2)
    console.log(`reroute timing (ms) on ${graph.size} nodes, 10000-step loop:\n${Object.entries(rows).map(([k, v]) => `  ${k.padEnd(34)} ${v}`).join('\n')}`)
    // Generous budgets (slow CI): the point is that nothing regresses by an order of magnitude.
    expect(Math.max(...local)).toBeLessThan(400)
    expect(local.length).toBeGreaterThan(0)
    expect(haversine(here, route.points[0]!)).toBeGreaterThan(0)
    expect(metresToSteps(1, 1)).toBeGreaterThan(0)
  })
})
