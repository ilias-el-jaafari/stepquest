import { describe, expect, it } from 'vitest'
import { haversine } from '../geo/geo.ts'
import { metresToSteps } from '../geo/steps.ts'
import { SAFETY_ALLEY, SAFETY_COVERED, SAFETY_LIT, SAFETY_SIDEWALK, SAFETY_UNLIT, type OsmData, type OsmWay } from '../osm/types.ts'
import { WalkGraph } from './graph.ts'
import { planWithSafety } from './safePlanner.ts'
import { AVENUE_NIGHT_BONUS, avoidedPolylines, edgeCosts, isAvenue, LIT_NIGHT, MAX_FACTOR, UNKNOWN_LIT_NIGHT, MIN_FACTOR, nearestStreet, normalizeName, routeSafety, safetyContext, safetyFactor, searchStreets, streetNames, type EdgeInfo } from './safety.ts'

const edge = (o: Partial<EdgeInfo> = {}): EdgeInfo => ({ highway: 'residential', flags: 0, tunnel: false, industrial: false, park: false, lively: 0, ...o })

describe('safetyFactor', () => {
  it('prefers pedestrian and residential streets over alleys and tracks', () => {
    for (const night of [false, true]) {
      const ped = safetyFactor(edge({ highway: 'pedestrian' }), night)
      const res = safetyFactor(edge(), night)
      const service = safetyFactor(edge({ highway: 'service' }), night)
      const alley = safetyFactor(edge({ highway: 'service', flags: SAFETY_ALLEY }), night)
      const track = safetyFactor(edge({ highway: 'track' }), night)
      expect(ped).toBeLessThan(res)
      expect(res).toBeLessThan(service)
      expect(service).toBeLessThan(alley)
      expect(res).toBeLessThan(track)
    }
  })
  it('rewards lighting, sidewalks and lively streets; punishes tunnels and industrial land', () => {
    const base = safetyFactor(edge(), false)
    expect(safetyFactor(edge({ flags: SAFETY_LIT }), false)).toBeLessThan(base)
    expect(safetyFactor(edge({ flags: SAFETY_SIDEWALK }), false)).toBeLessThan(base)
    expect(safetyFactor(edge({ lively: 4 }), false)).toBeLessThan(safetyFactor(edge({ lively: 1 }), false))
    expect(safetyFactor(edge({ lively: 1 }), false)).toBeLessThan(base)
    expect(safetyFactor(edge({ flags: SAFETY_UNLIT }), false)).toBeGreaterThan(base)
    expect(safetyFactor(edge({ tunnel: true }), false)).toBeGreaterThan(base * 1.5)
    expect(safetyFactor(edge({ flags: SAFETY_COVERED }), false)).toBeGreaterThan(base * 1.5)
    expect(safetyFactor(edge({ industrial: true }), false)).toBeGreaterThan(base)
  })
  it('weighs lighting and parks much more at night', () => {
    const unlitPath = edge({ highway: 'footway', flags: SAFETY_UNLIT, park: true })
    expect(safetyFactor(unlitPath, true)).toBeGreaterThan(safetyFactor(unlitPath, false) * 2)
    const litGain = (night: boolean) => safetyFactor(edge(), night) / safetyFactor(edge({ flags: SAFETY_LIT }), night)
    expect(litGain(true)).toBeGreaterThan(litGain(false))
    // Steps are only a small penalty.
    expect(safetyFactor(edge({ highway: 'steps' }), false)).toBeLessThan(1.5)
  })
  it('treats untagged main avenues as lit and untagged side streets as darker', () => {
    for (const highway of ['primary', 'secondary', 'tertiary']) {
      // Untagged avenue = lit avenue; lit=no still counts as unlit.
      expect(safetyFactor(edge({ highway }), true)).toBeCloseTo(safetyFactor(edge({ highway, flags: SAFETY_LIT }), true), 6)
      expect(safetyFactor(edge({ highway, flags: SAFETY_UNLIT }), true)).toBeGreaterThan(2)
      // Small night bonus on top of lighting.
      expect(safetyFactor(edge({ highway }), true)).toBeCloseTo(LIT_NIGHT * AVENUE_NIGHT_BONUS, 6)
    }
    // A side street with unknown lighting is worse than a tagged-lit one, by day and much more at night.
    for (const night of [false, true]) expect(safetyFactor(edge(), night)).toBeGreaterThan(safetyFactor(edge({ flags: SAFETY_LIT }), night))
    expect(safetyFactor(edge(), true)).toBeCloseTo(0.92 * UNKNOWN_LIT_NIGHT, 6)
    expect(AVENUE_NIGHT_BONUS).toBeGreaterThan(0.9)
    expect(isAvenue('secondary_link')).toBe(true)
    expect(isAvenue('residential')).toBe(false)
  })
  it('makes an untagged side street, even a lively one, lose clearly to a main avenue at night', () => {
    for (const lively of [0, 1, 3]) {
      const side = safetyFactor(edge({ lively }), true)
      const avenue = safetyFactor(edge({ highway: 'tertiary', lively: 0 }), true)
      expect(side, `lively ${lively}`).toBeGreaterThan(avenue * (lively >= 3 ? 1.3 : 1.7))
    }
  })
  it('never lets an avenue beat a lit residential or pedestrian street at night', () => {
    const lit = SAFETY_LIT
    for (const lively of [0, 1]) {
      const avenue = safetyFactor(edge({ highway: 'primary', flags: lit, lively }), true)
      expect(avenue).toBeGreaterThan(safetyFactor(edge({ highway: 'residential', flags: lit, lively }), true))
      expect(avenue).toBeGreaterThan(safetyFactor(edge({ highway: 'pedestrian', flags: lit, lively }), true))
    }
    // With every sign present all streets reach the best factor; the avenue never goes below the others.
    for (const lively of [0, 1, 3]) {
      const all = SAFETY_LIT | SAFETY_SIDEWALK
      const busy = safetyFactor(edge({ highway: 'primary', flags: all, lively }), true)
      expect(busy).toBeGreaterThanOrEqual(safetyFactor(edge({ highway: 'residential', flags: all, lively }), true))
      expect(busy).toBeGreaterThanOrEqual(safetyFactor(edge({ highway: 'pedestrian', flags: all, lively }), true))
    }
  })
  it('stays within the clamp', () => {
    const worst = edge({ highway: 'track', flags: SAFETY_UNLIT | SAFETY_ALLEY | SAFETY_COVERED, tunnel: true, industrial: true, park: true })
    const best = edge({ highway: 'pedestrian', flags: SAFETY_LIT | SAFETY_SIDEWALK, lively: 9 })
    for (const night of [false, true]) {
      expect(safetyFactor(worst, night)).toBeLessThanOrEqual(MAX_FACTOR)
      expect(safetyFactor(best, night)).toBeGreaterThanOrEqual(MIN_FACTOR)
    }
  })
})

describe('street names', () => {
  it('normalizes case, accents and spacing', () => {
    expect(normalizeName('  Carrer de  Sant  JOSÉ ')).toBe(normalizeName('carrer de sant jose'))
  })
  it('searches by any part of the name, best matches first', () => {
    const names = ['Calle de Burjassot', 'Avenida del Doctor Peset Aleixandre', 'Calle de Sant Josep Artesà', 'Plaza de Burjassot']
    expect(searchStreets(names, 'burja')).toEqual(expect.arrayContaining(['Calle de Burjassot', 'Plaza de Burjassot']))
    expect(searchStreets(names, 'artesa')).toEqual(['Calle de Sant Josep Artesà'])
    expect(searchStreets(names, '')).toEqual([])
    expect(searchStreets(names, 'zzz')).toEqual([])
  })
})

// A tiny synthetic town: a short unlit alley and a longer lit residential detour between A and B.
const LAT = 39.49
const LON = -0.39
function town(): OsmData {
  const pts: [number, number][] = []
  const add = (dLat: number, dLon: number) => pts.push([LAT + dLat, LON + dLon]) - 1
  const a = add(0, 0)
  const alley = [a]
  for (let i = 1; i <= 6; i++) alley.push(add(0, i * 0.001))
  const b = alley[alley.length - 1]!
  const detour = [a, add(0.0015, 0)]
  for (let i = 1; i <= 6; i++) detour.push(add(0.0015, i * 0.001))
  detour.push(b)
  const way = (id: number, nodes: number[], o: Partial<OsmWay>): OsmWay => ({ id, kind: 'road', walkable: true, area: false, tunnel: false, crossing: false, nodes, ...o })
  return {
    bbox: { south: LAT - 0.002, west: LON - 0.002, north: LAT + 0.004, east: LON + 0.008 },
    lat: Float64Array.from(pts.map((p) => p[0])),
    lon: Float64Array.from(pts.map((p) => p[1])),
    ways: [
      way(1, alley, { highway: 'service', name: 'Callejón Oscuro', safety: SAFETY_ALLEY | SAFETY_UNLIT }),
      way(2, detour, { highway: 'residential', name: 'Calle Mayor', safety: SAFETY_LIT | SAFETY_SIDEWALK }),
    ],
    pois: [],
    source: 'fixture',
    timestamp: '2026-01-01T00:00:00Z',
  }
}

describe('safe routing on a synthetic town', () => {
  const data = town()
  const graph = new WalkGraph(data)
  const ctx = safetyContext(graph, data)
  const start = { lat: LAT, lon: LON }
  const end = { lat: LAT, lon: LON + 0.006 }
  const alleyM = haversine(start, end)
  const req = (metres: number) => ({ mode: 'oneway' as const, start, end, targetSteps: Math.round(metresToSteps(metres, 0.75)), strideM: 0.75, seed: 1 })

  it('lists the street names and finds the nearest one', () => {
    expect(streetNames(data)).toEqual(['Callejón Oscuro', 'Calle Mayor'].sort((x, y) => x.localeCompare(y)))
    expect(nearestStreet(data, { lat: LAT + 0.0001, lon: LON + 0.003 })).toBe('Callejón Oscuro')
    expect(nearestStreet(data, { lat: LAT + 0.0014, lon: LON + 0.003 })).toBe('Calle Mayor')
    expect(nearestStreet(data, { lat: LAT + 0.01, lon: LON + 0.003 })).toBeUndefined()
  })

  it('returns the geometry of avoided streets for the map', () => {
    expect(avoidedPolylines(data, [])).toEqual([])
    const lines = avoidedPolylines(data, ['CALLEJON OSCURO'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(7)
    expect(lines[0]![0]).toEqual(start)
    expect(avoidedPolylines(data, ['Nowhere Street'])).toEqual([])
  })

  it('closes avoided streets and returns no costs when nothing changes', () => {
    expect(edgeCosts(ctx, { safe: false, night: false, avoid: [] })).toBeUndefined()
    const c = edgeCosts(ctx, { safe: false, night: false, avoid: ['callejon oscuro'] })!
    expect(c.closed).toBeGreaterThan(0)
    expect([...c.cost].filter((v) => v === Infinity).length).toBe(c.closed)
  })

  it('takes the lit street when safe and the alley when not', () => {
    const detour = planWithSafety(graph, ctx, req(alleyM * 1.6), data.bbox, { safe: true, night: false, avoid: [] })
    expect(detour.result.ok).toBe(true)
    expect(detour.safety?.lit).toBeGreaterThan(0.9)
    expect(detour.notice).toBeUndefined()
  })

  it('offers the normal route when no safe route meets the goal', () => {
    const sp = planWithSafety(graph, ctx, req(alleyM), data.bbox, { safe: true, night: true, avoid: [] })
    expect(sp.result.ok).toBe(false)
    expect(sp.notice).toBe('safeInfeasible')
    expect(sp.normal?.ok).toBe(true)
    expect(routeSafety(graph, ctx, sp.normal!.route.nodes, true).lit).toBeLessThan(0.1)
  })

  it('hard-avoids listed streets and says so when it cannot', () => {
    const ok = planWithSafety(graph, ctx, req(alleyM), data.bbox, { safe: false, night: false, avoid: ['Calle Mayor'] })
    expect(ok.result.ok).toBe(true)
    expect(ok.notice).toBeUndefined()
    const blocked = planWithSafety(graph, ctx, req(alleyM), data.bbox, { safe: false, night: false, avoid: ['Callejón Oscuro', 'Calle Mayor'] })
    expect(blocked.notice).toBe('avoidIgnored')
    expect(blocked.result.ok).toBe(true)
    expect(blocked.avoidedUsed).toEqual(['Callejón Oscuro'])
  })
})

// Ilias's field test: to burn extra steps the route took a dark side street parallel to a lit avenue.
describe('dark parallel side street vs lit main avenue', () => {
  // A and B joined by a straight residential side street with unknown lighting and by a main
  // avenue (untagged, so presumed lit) that bends slightly and is about 5 % longer. A goal halfway
  // between the two lengths fits either within the ±5 % tolerance: only the safety cost decides.
  function corridor(): OsmData {
    const pts: [number, number][] = []
    const add = (dLat: number, dLon: number) => pts.push([LAT + dLat, LON + dLon]) - 1
    const a = add(0, 0)
    const side = [a]
    for (let i = 1; i <= 8; i++) side.push(add(0, i * 0.001))
    const b = side[side.length - 1]!
    const avenue = [a, add(0.0004, 0.0005)]
    for (let i = 1; i <= 7; i++) avenue.push(add(0.0004, i * 0.001 + 0.0002))
    avenue.push(b)
    const way = (id: number, nodes: number[], o: Partial<OsmWay>): OsmWay => ({ id, kind: 'road', walkable: true, area: false, tunnel: false, crossing: false, nodes, ...o })
    return {
      bbox: { south: LAT - 0.002, west: LON - 0.002, north: LAT + 0.003, east: LON + 0.01 },
      lat: Float64Array.from(pts.map((p) => p[0])),
      lon: Float64Array.from(pts.map((p) => p[1])),
      ways: [way(1, avenue, { highway: 'tertiary', name: 'Avinguda Gran' }), way(2, side, { highway: 'residential', name: 'Carrer Fosc' })],
      pois: [],
      source: 'fixture',
      timestamp: '2026-01-01T00:00:00Z',
    }
  }
  const data = corridor()
  const graph = new WalkGraph(data)
  const ctx = safetyContext(graph, data)
  const start = { lat: LAT, lon: LON }
  const end = { lat: LAT, lon: LON + 0.008 }
  const on = (nodes: readonly number[], name: string) => {
    let len = 0
    let total = 0
    for (let i = 1; i < nodes.length; i++) {
      for (let k = graph.offsets[nodes[i - 1]!]!; k < graph.offsets[nodes[i - 1]! + 1]!; k++) {
        if (graph.targets[k] !== nodes[i]) continue
        total += graph.lengths[k]!
        if (ctx.names[graph.edgeIds[k]!] === name) len += graph.lengths[k]!
        break
      }
    }
    return len / total
  }
  it('walks the lit avenue, not the dark side street, even though the side street fits the goal too', () => {
    const length = (name: string) => {
      const w = data.ways.find((x) => x.name === name)!
      let m = 0
      for (let i = 1; i < w.nodes.length; i++) m += haversine({ lat: data.lat[w.nodes[i - 1]!]!, lon: data.lon[w.nodes[i - 1]!]! }, { lat: data.lat[w.nodes[i]!]!, lon: data.lon[w.nodes[i]!]! })
      return m
    }
    const sideM = length('Carrer Fosc')
    const avenueM = length('Avinguda Gran')
    expect(avenueM / sideM).toBeGreaterThan(1.03)
    expect(avenueM / sideM).toBeLessThan(1.09)
    const goalM = (sideM + avenueM) / 2
    for (const night of [true, false]) {
      const sp = planWithSafety(graph, ctx, { mode: 'oneway', start, end, targetSteps: Math.round(metresToSteps(goalM, 0.75)), strideM: 0.75, seed: 1 }, data.bbox, { safe: true, night, avoid: [] })
      expect(sp.result.ok).toBe(true)
      const r = sp.result.ok ? sp.result.route : sp.result.closest!
      expect(on(r.nodes, 'Avinguda Gran'), night ? 'night' : 'day').toBeGreaterThan(0.9)
      expect(on(r.nodes, 'Carrer Fosc')).toBeLessThan(0.1)
    }
  })
})
