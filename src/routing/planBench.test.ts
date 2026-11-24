import { describe, expect, it } from 'vitest'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { WalkGraph } from './graph.ts'
import { planLoop, planOneWay, type RouteRequest } from './planner.ts'
import { edgeCosts, safetyContext } from './safety.ts'

/**
 * Timing of the INITIAL plan (the tuning search), next to rerouteBench.test.ts
 * which times the reroute path. Prints a breakdown and asserts only a generous
 * budget, so it guards against order-of-magnitude regressions without flaking.
 */
function ms<T>(f: () => T): [T, number] {
  const t = performance.now()
  const v = f()
  return [v, performance.now() - t]
}

function med(f: () => unknown, runs = 5): number {
  const t: number[] = []
  for (let i = 0; i < runs; i++) t.push(ms(f)[1])
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

describe('initial plan timing on the Benicalap map', () => {
  it('shows where the time goes and stays within a budget', () => {
    const data = loadDemoOsm()
    const graph = new WalkGraph(data)
    const ctx = safetyContext(graph, data)
    const costs = edgeCosts(ctx, { safe: true, night: false, avoid: [] })!
    const area = DEMO_AREA.bbox
    const base = { start: DEMO_AREA.defaultStart, end: DEMO_AREA.defaultEnd, strideM: 0.75 }
    const loopReq: RouteRequest = { ...base, mode: 'loop', targetSteps: 10_000, seed: 1 }
    const oneReq: RouteRequest = { ...base, mode: 'oneway', targetSteps: 10_000 }

    // Count the primitive calls a plan makes.
    let nearest = 0
    let astar = 0
    const nn = graph.nearestNode.bind(graph)
    const sp = graph.shortestPath.bind(graph)
    graph.nearestNode = (...a) => (nearest++, nn(...a))
    graph.shortestPath = (...a) => (astar++, sp(...a))

    const rows: Record<string, string> = {}
    const a = graph.nearestNode(base.start)!.node
    const b = graph.nearestNode(base.end)!.node
    nearest = 0
    rows['nearest node (1 call, ms)'] = med(() => graph.nearestNode(base.start), 50).toFixed(3)
    rows['A* start→end (1 leg, ms)'] = med(() => graph.shortestPath(a, b, costs.cost, costs.min), 50).toFixed(2)

    for (const [label, run, req] of [
      ['loop 10k', planLoop, loopReq],
      ['loop 10k safe', planLoop, { ...loopReq, cost: costs.cost, minCost: costs.min }],
      ['oneway 10k', planOneWay, oneReq],
      ['oneway 10k safe', planOneWay, { ...oneReq, cost: costs.cost, minCost: costs.min }],
    ] as const) {
      nearest = 0
      astar = 0
      const [result] = ms(() => run(graph, req, area))
      const t = med(() => run(graph, req, area), 7) // median of 7 warm runs
      nearest = 0
      astar = 0
      run(graph, req, area)
      rows[`${label} (ms)`] = t.toFixed(0)
      rows[`${label} nearestNode calls / A* legs`] = `${nearest} / ${astar}`
      expect(result.ok).toBe(true)
      expect(t).toBeLessThan(15_000)
    }
    console.table(rows)
  })
})
