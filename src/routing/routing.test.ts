import { beforeAll, describe, expect, it } from 'vitest'
import { haversine } from '../geo/geo.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { cumulativeDistances, defaultCheckpointCount, placeCheckpoints, pointAlong } from './checkpoints.ts'
import { WalkGraph } from './graph.ts'
import { MinHeap } from './heap.ts'
import { bearingBetween, planRoute, type RouteRequest } from './planner.ts'

let graph: WalkGraph
const area = DEMO_AREA.bbox
const base: Omit<RouteRequest, 'mode' | 'targetSteps'> = {
  start: DEMO_AREA.defaultStart,
  end: DEMO_AREA.defaultEnd,
  strideM: 0.75,
}

beforeAll(() => {
  graph = new WalkGraph(loadDemoOsm())
})

describe('MinHeap', () => {
  it('pops in ascending key order', () => {
    const heap = new MinHeap()
    const keys = [5, 1, 9, 3, 3, 7, 0, 12, 2]
    keys.forEach((k, i) => heap.push(k, i))
    const out: number[] = []
    for (let v = heap.pop(); v !== undefined; v = heap.pop()) out.push(keys[v]!)
    expect(out).toEqual([...keys].sort((a, b) => a - b))
  })
})

describe('WalkGraph on the Benicalap fixture', () => {
  it('builds a sizeable connected pedestrian network', () => {
    expect(graph.size).toBeGreaterThan(10_000)
    const main = [...graph.component].filter((c) => c === 0).length
    expect(main / graph.size).toBeGreaterThan(0.8)
  })
  it('snaps the demo start onto the network within a few metres', () => {
    const snap = graph.nearestNode(DEMO_AREA.defaultStart)
    expect(snap).toBeDefined()
    expect(snap!.distance).toBeLessThan(40)
  })
  it('finds a shortest path no shorter than the straight line and not absurdly longer', () => {
    const a = graph.nearestNode(DEMO_AREA.defaultStart)!.node
    const b = graph.nearestNode(DEMO_AREA.defaultEnd)!.node
    const path = graph.shortestPath(a, b)!
    const straight = haversine(graph.point(a), graph.point(b))
    expect(path.length).toBeGreaterThanOrEqual(straight)
    expect(path.length).toBeLessThan(straight * 1.6)
    expect(path.nodes[0]).toBe(a)
    expect(path.nodes[path.nodes.length - 1]).toBe(b)
    // Consecutive nodes are real edges.
    for (let i = 1; i < path.nodes.length; i++) {
      const n = path.nodes[i - 1]!
      let found = false
      for (let j = graph.offsets[n]!; j < graph.offsets[n + 1]!; j++) if (graph.targets[j] === path.nodes[i]) found = true
      expect(found).toBe(true)
    }
  })
  it('returns a zero-length path from a node to itself', () => {
    expect(graph.shortestPath(5, 5)).toEqual({ nodes: [5], edges: [], length: 0 })
  })
})

describe('loop routes', () => {
  for (const targetSteps of [3000, 6000, 10_000, 14_000]) {
    it(`matches a ${targetSteps}-step loop within ±5 %`, () => {
      const result = planRoute(graph, { ...base, mode: 'loop', targetSteps }, area)
      expect(result.ok, JSON.stringify(result.ok ? '' : result.reason)).toBe(true)
      if (!result.ok) return
      const r = result.route
      expect(Math.abs(r.distanceM - stepsToMetres(targetSteps)) / stepsToMetres(targetSteps)).toBeLessThanOrEqual(0.05)
      expect(r.nodes[0]).toBe(r.nodes[r.nodes.length - 1])
      expect(r.overlap).toBeLessThan(0.25)
    })
  }
  it('gives a different loop for a different seed', () => {
    const a = planRoute(graph, { ...base, mode: 'loop', targetSteps: 8000, seed: 1 }, area)
    const b = planRoute(graph, { ...base, mode: 'loop', targetSteps: 8000, seed: 2 }, area)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.route.nodes.join()).not.toBe(b.route.nodes.join())
  })
  it('is deterministic for the same seed', () => {
    const a = planRoute(graph, { ...base, mode: 'loop', targetSteps: 8000, seed: 7 }, area)
    const b = planRoute(graph, { ...base, mode: 'loop', targetSteps: 8000, seed: 7 }, area)
    expect(a.ok && b.ok && a.route.nodes.join() === b.route.nodes.join()).toBe(true)
  })
  it('rejects a start outside the loaded area', () => {
    const result = planRoute(graph, { ...base, start: { lat: 40.4168, lon: -3.7038 }, mode: 'loop', targetSteps: 10_000 }, area)
    expect(result).toMatchObject({ ok: false, reason: 'outsideArea' })
  })
  it('honours the stride when converting the target', () => {
    const result = planRoute(graph, { ...base, mode: 'loop', targetSteps: 10_000, strideM: 0.6 }, area)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.route.targetM).toBeCloseTo(6000, 6)
      expect(Math.abs(result.route.steps - 10_000)).toBeLessThanOrEqual(500)
    }
  })
})

describe('one-way routes (A → B)', () => {
  const direct = () => {
    const a = graph.nearestNode(DEMO_AREA.defaultStart)!.node
    const b = graph.nearestNode(DEMO_AREA.defaultEnd)!.node
    return graph.shortestPath(a, b)!.length
  }

  it('reports "too short" with the minimum steps when the target is below the direct path', () => {
    const result = planRoute(graph, { ...base, mode: 'oneway', targetSteps: 1000 }, area)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('tooShort')
    expect(result.minSteps).toBe(Math.round(direct() / 0.75))
  })
  it('uses the direct path when it already matches the target', () => {
    const steps = Math.round(direct() / 0.75)
    const result = planRoute(graph, { ...base, mode: 'oneway', targetSteps: steps }, area)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.route.overlap).toBe(0)
  })
  for (const targetSteps of [4000, 7000, 10_000]) {
    it(`adds a detour to reach ${targetSteps} steps within ±5 %`, () => {
      const result = planRoute(graph, { ...base, mode: 'oneway', targetSteps }, area)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const r = result.route
      expect(r.withinTolerance).toBe(true)
      const first = r.points[0]!
      const last = r.points[r.points.length - 1]!
      expect(haversine(first, DEMO_AREA.defaultStart)).toBeLessThan(60)
      expect(haversine(last, DEMO_AREA.defaultEnd)).toBeLessThan(60)
    })
  }
  for (const targetSteps of [12_000, 15_000]) {
    it(`reaches a long ${targetSteps}-step A → B goal within ±5 % without walking streets twice`, () => {
      const result = planRoute(graph, { ...base, mode: 'oneway', targetSteps }, area)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(Math.abs(result.route.steps - targetSteps)).toBeLessThanOrEqual(targetSteps * 0.05)
      expect(result.route.overlap).toBeLessThan(0.12)
      expect(haversine(result.route.points.at(-1)!, DEMO_AREA.defaultEnd)).toBeLessThan(60)
    })
  }
  it('reports "too long" with the most steps reachable when the target cannot fit', () => {
    const result = planRoute(graph, { ...base, mode: 'oneway', targetSteps: 60_000 }, area)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('tooLong')
    expect(result.maxSteps).toBeGreaterThan(result.minSteps!)
    expect(result.maxSteps).toBeLessThan(60_000)
  })
  it('rejects identical start and end', () => {
    const result = planRoute(graph, { ...base, end: base.start, mode: 'oneway', targetSteps: 3000 }, area)
    expect(result).toMatchObject({ ok: false, reason: 'samePoint' })
  })
})

describe('checkpoints', () => {
  const line = [
    { lat: 39.49, lon: -0.39 },
    { lat: 39.5, lon: -0.39 },
    { lat: 39.5, lon: -0.38 },
  ]
  it('defaults to one per ~1,000 steps', () => {
    expect(defaultCheckpointCount(10_000)).toBe(10)
    expect(defaultCheckpointCount(2400)).toBe(2)
    expect(defaultCheckpointCount(100)).toBe(1)
    expect(defaultCheckpointCount(1e6)).toBe(30)
  })
  it('spaces checkpoints evenly and ends at the finish', () => {
    const cps = placeCheckpoints(line, 5)
    const total = cumulativeDistances(line).at(-1)!
    expect(cps).toHaveLength(5)
    cps.forEach((cp, i) => expect(cp.distanceM).toBeCloseTo((total * (i + 1)) / 5, 6))
    expect(cps.at(-1)!.isFinish).toBe(true)
    expect(haversine(cps.at(-1)!.point, line[2]!)).toBeLessThan(0.01)
    expect(cps.slice(0, -1).every((c) => !c.isFinish)).toBe(true)
  })
  it('puts each checkpoint on the polyline at its distance', () => {
    const cum = cumulativeDistances(line)
    const p = pointAlong(line, cum, cum[1]!)
    expect(haversine(p, line[1]!)).toBeLessThan(0.01)
    expect(pointAlong(line, cum, -5)).toEqual(line[0])
    expect(pointAlong(line, cum, 1e9)).toEqual(line[2])
  })
  it('keeps real route checkpoints evenly spaced along the walk', () => {
    const result = planRoute(graph, { ...base, mode: 'loop', targetSteps: 10_000 }, area)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { checkpoints, distanceM } = result.route
    expect(checkpoints).toHaveLength(10)
    const gaps = checkpoints.map((c, i) => c.distanceM - (i === 0 ? 0 : checkpoints[i - 1]!.distanceM))
    for (const gap of gaps) expect(gap).toBeCloseTo(distanceM / 10, 6)
    // A loop's last checkpoint is back at the start.
    expect(haversine(checkpoints.at(-1)!.point, result.route.points[0]!)).toBeLessThan(1)
  })
})

describe('bearingBetween', () => {
  it('returns compass bearings', () => {
    expect(bearingBetween({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6)
    expect(bearingBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6)
    expect(bearingBetween({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6)
  })
})

describe('robustness across the demo area', () => {
  // Deterministic pseudo-random points in the central 60 % of the box.
  let s = 42
  const rnd = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const inner = () => ({
    lat: area.south + (area.north - area.south) * (0.2 + rnd() * 0.6),
    lon: area.west + (area.east - area.west) * (0.2 + rnd() * 0.6),
  })
  const inside = (p: { lat: number; lon: number }) =>
    p.lat >= area.south && p.lat <= area.north && p.lon >= area.west && p.lon <= area.east

  it('plans 8,000-step loops from 30 random starts, all inside the map', () => {
    let ok = 0
    for (let i = 0; i < 30; i++) {
      const r = planRoute(graph, { mode: 'loop', start: inner(), targetSteps: 8000, strideM: 0.75 }, area)
      if (!r.ok) continue
      ok++
      expect(r.route.points.every(inside)).toBe(true)
    }
    expect(ok).toBeGreaterThanOrEqual(28)
  })
  it('plans most random 8,000-step A→B walks or explains why not', () => {
    let ok = 0
    for (let i = 0; i < 30; i++) {
      const r = planRoute(graph, { mode: 'oneway', start: inner(), end: inner(), targetSteps: 8000, strideM: 0.75 }, area)
      if (r.ok) ok++
      else expect(['tooShort', 'tooLong', 'noMatch']).toContain(r.reason)
    }
    expect(ok).toBeGreaterThanOrEqual(24)
  })
  it('hardly ever walks a street twice (loops and A → B detours)', () => {
    const overlaps: number[] = []
    for (let i = 0; i < 24; i++) {
      const mode = i % 2 ? 'loop' : 'oneway'
      const r = planRoute(graph, { mode, start: inner(), end: inner(), targetSteps: [5000, 9000, 12_000][i % 3]!, strideM: 0.75, seed: i }, area)
      if (r.ok) overlaps.push(r.route.overlap)
    }
    expect(overlaps.length).toBeGreaterThanOrEqual(20)
    const mean = overlaps.reduce((a, b) => a + b, 0) / overlaps.length
    expect(mean).toBeLessThan(0.012)
    expect(Math.max(...overlaps)).toBeLessThan(0.08)
  })
})
