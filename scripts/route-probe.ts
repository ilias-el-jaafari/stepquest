// Quick manual probe of the planner on the bundled fixture.
import { readFileSync } from 'node:fs'
import { decodeOsm, type CompactOsm } from '../src/osm/codec.ts'
import { DEMO_AREA } from '../src/osm/demoArea.ts'
import { WalkGraph } from '../src/routing/graph.ts'
import { planRoute } from '../src/routing/planner.ts'

const data = decodeOsm(JSON.parse(readFileSync('src/data/benicalap.osm.json', 'utf8')) as CompactOsm)
let t = performance.now()
const graph = new WalkGraph(data)
console.log('graph', graph.size, 'nodes', graph.edgeCount, 'edges', (performance.now() - t).toFixed(0), 'ms')
const cases = [
  { mode: 'loop' as const, targetSteps: 10_000 },
  { mode: 'loop' as const, targetSteps: 3_000 },
  { mode: 'loop' as const, targetSteps: 15_000 },
  { mode: 'oneway' as const, targetSteps: 4_000 },
  { mode: 'oneway' as const, targetSteps: 10_000 },
  { mode: 'oneway' as const, targetSteps: 1_000 },
  { mode: 'oneway' as const, targetSteps: 60_000 },
]
for (const c of cases) {
  t = performance.now()
  const r = planRoute(graph, { ...c, start: DEMO_AREA.defaultStart, end: DEMO_AREA.defaultEnd, strideM: 0.75 }, DEMO_AREA.bbox)
  const route = r.ok ? r.route : r.closest
  console.log(c.mode, c.targetSteps, r.ok ? 'OK' : `FAIL ${r.reason} min=${r.minSteps} max=${r.maxSteps}`,
    route ? `steps=${route.steps} err=${(route.error * 100).toFixed(1)}% overlap=${(route.overlap * 100).toFixed(0)}%` : '',
    (performance.now() - t).toFixed(0), 'ms')
}

// Robustness: random starts and pairs across the inner part of the area.
const rnd = (() => {
  let s = 42
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
})()
const inner = (f: number) => ({
  lat: DEMO_AREA.bbox.south + (DEMO_AREA.bbox.north - DEMO_AREA.bbox.south) * (0.5 + (rnd() - 0.5) * f),
  lon: DEMO_AREA.bbox.west + (DEMO_AREA.bbox.east - DEMO_AREA.bbox.west) * (0.5 + (rnd() - 0.5) * f),
})
for (const mode of ['loop', 'oneway'] as const) {
  let ok = 0
  let overlap = 0
  let worst = 0
  const fails: string[] = []
  t = performance.now()
  for (let i = 0; i < 40; i++) {
    const r = planRoute(graph, { mode, start: inner(0.6), end: inner(0.6), targetSteps: 8000, strideM: 0.75 }, DEMO_AREA.bbox)
    if (r.ok) {
      ok++
      overlap += r.route.overlap
      worst = Math.max(worst, r.route.overlap)
    } else fails.push(r.reason)
  }
  console.log(mode, `${ok}/40 ok, mean overlap ${(overlap / Math.max(1, ok) * 100).toFixed(0)}%, worst ${(worst * 100).toFixed(0)}%`, fails.join(','), ((performance.now() - t) / 40).toFixed(0), 'ms avg')
}
