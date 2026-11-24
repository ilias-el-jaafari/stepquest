import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from './demo.ts'
import { isValidBBox } from '../geo/geo.ts'
import { isCoarseWay } from './coarse.ts'
import type { OsmData } from './types.ts'

const toCoarse = (d: OsmData): OsmData => ({ ...d, ways: d.ways.filter(isCoarseWay), pois: [], activity: [], industrial: [] })

describe('coarse layer filter (requirement 21.4)', () => {
  it('keeps the streets and the big areas of the bundled extract and drops the rest', () => {
    const data = loadDemoOsm()
    const kinds = new Set(toCoarse(data).ways.map((w) => w.kind))
    expect([...kinds].sort()).toEqual(['park', 'rail', 'road', 'water', 'waterway'].filter((k) => kinds.has(k as never)).sort())
    expect(kinds.has('road')).toBe(true)
    expect(kinds.has('park')).toBe(true)
    for (const w of toCoarse(data).ways) expect(isCoarseWay(w)).toBe(true)
    const coarse = toCoarse(data)
    expect(coarse.pois).toEqual([])
    expect(coarse.activity).toEqual([])
    expect(isValidBBox(coarse.bbox)).toBe(true)
  })

  it('is much lighter than the detail layer: under 16 % of the way points of the bundled extract (measured: 14.7 %)', () => {
    const data = loadDemoOsm()
    const points = (ways: { nodes: number[] }[]) => ways.reduce((s, w) => s + w.nodes.length, 0)
    const all = points(data.ways)
    const some = points(toCoarse(data).ways)
    // The share is what the query saves on the wire and in parsing; buildings alone are 46 % of the points.
    expect(some / all).toBeLessThan(0.16)
    expect(some / all).toBeGreaterThan(0.05)
  })
})
