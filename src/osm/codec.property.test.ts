import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CorruptDataError, decodeOsm, encodeOsm, type CompactOsm } from './codec.ts'
import { loadDemoOsm } from './demo.ts'
import { FEATURE_KINDS, LANDMARK_KINDS, type OsmData, type OsmWay } from './types.ts'

const SEED = 20261204

const micro = (lo: number, hi: number) => fc.integer({ min: Math.round(lo * 1e6), max: Math.round(hi * 1e6) }).map((n) => n / 1e6)
const text = fc.string({ unit: fc.constantFrom(...'abcdeñÁ -.'.split('')), minLength: 1, maxLength: 12 })

const dataArb: fc.Arbitrary<OsmData> = fc.integer({ min: 2, max: 30 }).chain((count) => {
  const way = fc.record({
    id: fc.integer({ min: 1, max: 2 ** 40 }),
    kind: fc.constantFrom(...FEATURE_KINDS),
    highway: fc.option(fc.constantFrom('residential', 'footway', 'primary', 'steps', 'service'), { nil: undefined }),
    walkable: fc.boolean(),
    area: fc.boolean(),
    tunnel: fc.boolean(),
    crossing: fc.boolean(),
    bridge: fc.option(fc.constant(true), { nil: undefined }),
    holes: fc.option(fc.array(fc.array(fc.integer({ min: 0, max: count - 1 }), { minLength: 4, maxLength: 8 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
    roundabout: fc.option(fc.constant(true), { nil: undefined }),
    sub: fc.option(text, { nil: undefined }),
    nodes: fc.array(fc.integer({ min: 0, max: count - 1 }), { minLength: 2, maxLength: 12 }),
    name: fc.option(text, { nil: undefined }),
    safety: fc.integer({ min: 0, max: 31 }),
  })
  return fc.record({
    bbox: fc.constant({ south: 39.4, west: -0.5, north: 39.6, east: -0.3 }),
    lat: fc.array(micro(39.4, 39.6), { minLength: count, maxLength: count }).map((a) => Float64Array.from(a)),
    lon: fc.array(micro(-0.5, -0.3), { minLength: count, maxLength: count }).map((a) => Float64Array.from(a)),
    ways: fc.array(way, { maxLength: 15 }).map((ways) => ways.map((w): OsmWay => (w.walkable ? w : { ...w, safety: undefined }))),
    pois: fc.array(fc.record({ kind: fc.constantFrom(...LANDMARK_KINDS), lat: micro(39.4, 39.6), lon: micro(-0.5, -0.3) }), { maxLength: 6 }),
    industrial: fc.array(fc.array(fc.integer({ min: 0, max: count - 1 }), { minLength: 3, maxLength: 6 }), { maxLength: 3 }),
    activity: fc.array(micro(-1, 40), { maxLength: 8 }),
    source: fc.constantFrom<'fixture' | 'overpass'>('fixture', 'overpass'),
    timestamp: fc.constant('2026-11-22T12:00:00Z'),
  })
})

/** Without optional keys that hold undefined, so toEqual compares what the data means. */
const clean = (d: OsmData) => JSON.parse(JSON.stringify({ ...d, lat: [...d.lat], lon: [...d.lon] }))

describe('codec properties', () => {
  it('P-M1: decode(encode(x)) equals x for any map, also through JSON text (the fixture and cache form)', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const compact = encodeOsm(data)
        const direct = decodeOsm(compact)
        const viaJson = decodeOsm(JSON.parse(JSON.stringify(compact)))
        expect(clean(direct)).toEqual(clean(data))
        expect(clean(viaJson)).toEqual(clean(data))
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('P-M1: encoding is stable: encode(decode(encode(x))) equals encode(x)', () => {
    fc.assert(
      fc.property(dataArb, (data) => {
        const once = encodeOsm(data)
        expect(encodeOsm(decodeOsm(once))).toEqual(once)
      }),
      { seed: SEED, numRuns: 100 },
    )
  })

  it('P-M1: the bundled Benicalap extract survives a re-encode unchanged', () => {
    const demo = loadDemoOsm()
    const again = decodeOsm(encodeOsm(demo))
    expect(again.ways).toEqual(demo.ways)
    expect([...again.lat]).toEqual([...demo.lat])
    expect([...again.lon]).toEqual([...demo.lon])
    expect(again.pois).toEqual(demo.pois)
  })
})

describe('codec robustness (task 66.5)', () => {
  it('P-M2: damaged compact data is rejected with CorruptDataError or decodes to valid indices, never garbage', () => {
    fc.assert(
      fc.property(dataArb, fc.nat({ max: 5 }), fc.integer({ min: -5, max: 1e6 }), (data, which, junk) => {
        const compact = JSON.parse(JSON.stringify(encodeOsm(data))) as CompactOsm
        if (which === 0) compact.dlon.push(junk)
        else if (which === 1 && compact.ways[0]) compact.ways[0]![0] = junk
        else if (which === 2 && compact.ways[0]) compact.ways[0].push(junk)
        else if (which === 3) compact.dlat = compact.dlat.slice(0, -1)
        else if (which === 4) compact.bbox = [1, 2, 3] as unknown as CompactOsm['bbox']
        else compact.v = junk as unknown as CompactOsm['v']
        try {
          const out = decodeOsm(compact)
          for (const way of out.ways) for (const n of way.nodes) expect(n >= 0 && n < out.lat.length).toBe(true)
        } catch (error) {
          expect(error).toBeInstanceOf(CorruptDataError)
        }
      }),
      { seed: SEED, numRuns: 300 },
    )
  })
})
