import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { sliceToCells, type CellRecord } from '../world/slice.ts'
import { compact, WorldData } from '../world/worldData.ts'
import { GraphAccumulator, WalkGraph } from './graph.ts'

/** The graph as a set of edges between coordinates (ids differ with the order cells arrive in). */
function edgeSet(g: WalkGraph): string[] {
  const out: string[] = []
  for (let n = 0; n < g.size; n++) {
    for (let i = g.offsets[n]!; i < g.offsets[n + 1]!; i++) {
      const m = g.targets[i]!
      if (n >= m) continue
      const ends = [`${g.lat[n]},${g.lon[n]}`, `${g.lat[m]},${g.lon[m]}`].sort()
      out.push(`${ends[0]}|${ends[1]}|${g.lengths[i]!.toFixed(3)}`)
    }
  }
  return out.sort()
}

const records = sliceToCells(loadDemoOsm())

function incremental(order: readonly CellRecord[], batch: number) {
  const wd = new WorldData()
  const acc = new GraphAccumulator()
  const sizes: number[] = []
  for (let k = 0; k < order.length; k += batch) {
    let first = wd.ways.length
    for (const r of order.slice(k, k + batch)) first = Math.min(first, wd.addRecord(r).firstWay)
    acc.add(wd.snapshot(), first)
    sizes.push(acc.pairs.length)
  }
  return { graph: new WalkGraph(acc), wd, acc, sizes }
}

describe('incremental walking graph', () => {
  it('slices the demo into several cells', () => {
    expect(records.length).toBeGreaterThanOrEqual(8)
  })

  it('P-G4 has the same nodes and edges (by coordinates) as a graph built in one go from the merged data', () => {
    const oneGo = new WalkGraph(compact(records).snapshot())
    for (const order of [records, [...records].reverse(), [...records].sort((a, b) => ((a.cell.i * 7 + a.cell.j * 13) % 5) - ((b.cell.i * 7 + b.cell.j * 13) % 5))]) {
      for (const batch of [1, 3]) {
        const { graph } = incremental(order, batch)
        expect(graph.size).toBe(oneGo.size)
        expect(graph.edgeCount).toBe(oneGo.edgeCount)
        expect(edgeSet(graph)).toEqual(edgeSet(oneGo))
      }
    }
  })

  it('has no duplicate edge or node', () => {
    const { graph } = incremental(records, 2)
    const edges = edgeSet(graph)
    expect(new Set(edges).size).toBe(edges.length)
    const nodes = Array.from({ length: graph.size }, (_, n) => `${graph.lat[n]},${graph.lon[n]}`)
    expect(new Set(nodes).size).toBe(nodes.length)
  })

  it('stays close to the graph of the single extract (cells only cut and rejoin it)', () => {
    const single = new WalkGraph(loadDemoOsm())
    const { graph } = incremental(records, 2)
    expect(Math.abs(graph.edgeCount - single.edgeCount) / single.edgeCount).toBeLessThan(0.01)
  })

  it('keeps node and edge ids when cells are added, and only appends', () => {
    const half = Math.ceil(records.length / 2)
    const wd = new WorldData()
    const acc = new GraphAccumulator()
    for (const r of records.slice(0, half)) wd.addRecord(r)
    acc.add(wd.snapshot(), 0)
    const before = new WalkGraph(acc)
    const pairs = acc.pairs.slice()
    const first = wd.ways.length
    for (const r of records.slice(half)) wd.addRecord(r)
    acc.add(wd.snapshot(), first)
    const after = new WalkGraph(acc)
    expect(after.size).toBeGreaterThan(before.size)
    for (let n = 0; n < before.size; n++) {
      expect(after.lat[n]).toBe(before.lat[n])
      expect(after.lon[n]).toBe(before.lon[n])
    }
    expect(acc.pairs.slice(0, pairs.length)).toEqual(pairs)
  })

  it('joins the two halves of a street across the border (edges that were outside get added)', () => {
    const { sizes } = incremental(records, 1)
    expect(sizes.at(-1)).toBeGreaterThan(sizes[0]!)
    // Every cell added more edges than the previous total, or at least never fewer.
    sizes.reduce((prev, s) => {
      expect(s).toBeGreaterThanOrEqual(prev)
      return s
    }, 0)
  })
})
