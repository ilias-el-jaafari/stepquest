import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from './demo.ts'
import { isValidBBox } from '../geo/geo.ts'
import { COARSE_HIGHWAYS, isCoarseWay, overpassCoarseQuery, toCoarse } from './coarse.ts'

const bbox = { south: 39.45, west: -0.4, north: 39.5, east: -0.35 }

describe('coarse layer query and filter (requirement 20.1)', () => {
  it('asks for streets, big green and blue areas, rivers and rail, and for no buildings or paths', () => {
    const q = overpassCoarseQuery(bbox, 30)
    expect(q.startsWith('[out:json][timeout:30];')).toBe(true)
    expect(q).toContain('out geom qt;')
    expect(q).toContain(`way["highway"~"^(${COARSE_HIGHWAYS})$"]`)
    expect(q).toContain('way["waterway"~"^(river|canal)$"]')
    expect(q).not.toMatch(/building|barrier|footway|path|"shop"|amenity|nw\[/)
    expect(() => overpassCoarseQuery({ ...bbox, north: Number.NaN })).toThrow(RangeError)
  })

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
