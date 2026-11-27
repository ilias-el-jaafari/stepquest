import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeOsm, encodeOsm } from '../osm/codec.ts'
import { destination, type LatLon } from '../geo/geo.ts'
import { tileToOsm } from '../vector/omt.ts'
import { encodeMvt, type FixtureFeature } from '../vector/testing.ts'
import { WorldData } from '../world/worldData.ts'
import { groundKind, groupPieces, linkSights } from './grounds.ts'
import { distanceToRingM, pointInRing } from './geometry.ts'
import { sightsAlongRoute } from './route.ts'
import type { Ground, LinkedSight, Sight } from './types.ts'

const T = { z: 14, x: 8174, y: 6233 }
const O: LatLon = { lat: 39.47, lon: -0.376 }
const square = (c: LatLon, half: number): number[] => {
  const pts = [destination(destination(c, 0, half), 270, half), destination(destination(c, 0, half), 90, half), destination(destination(c, 180, half), 90, half), destination(destination(c, 180, half), 270, half)]
  return pts.flatMap((p) => [p.lat, p.lon])
}
const poly = (x0: number, y0: number, x1: number, y1: number): FixtureFeature => ({ type: 3, props: {}, geometry: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })
const pt = (props: Record<string, string | number>, x: number, y: number): FixtureFeature => ({ type: 1, props, geometry: [[[x, y]]] })

describe('sight areas from a tile', () => {
  const bytes = () =>
    encodeMvt([
      { name: 'landuse', features: [{ ...poly(1000, 1000, 2000, 2000), props: { class: 'university' } }, { ...poly(3000, 3000, 3500, 3500), props: { class: 'residential' } }, { ...poly(2500, 500, 2900, 900), props: { class: 'school' } }] },
      { name: 'building', features: [poly(1200, 1200, 1500, 1500), poly(3600, 100, 3700, 200)] },
      { name: 'poi', features: [pt({ class: 'college', subclass: 'university', name: 'Campus' }, 1300, 1300), pt({ class: 'town_hall', subclass: 'townhall', name: 'Ajuntament' }, 3650, 150)] },
    ])

  it('keeps landuse grounds of university and school, not other land', () => {
    const data = tileToOsm(bytes(), T)
    const grounds = (data.grounds ?? []).filter((g) => g.mode === 'grounds')
    expect(grounds.map((g) => g.kind).sort()).toEqual(['school', 'university'])
    expect(grounds.every((g) => g.ring.length >= 6 && g.ring.length % 2 === 0)).toBe(true)
  })

  it('keeps the building polygon that holds a sight point as its footprint', () => {
    const data = tileToOsm(bytes(), T)
    const fp = (data.grounds ?? []).filter((g) => g.mode === 'footprint')
    expect(fp.map((g) => g.kind).sort()).toEqual(['townHall', 'university'])
    const hall = data.sights!.find((s) => s.kind === 'townHall')!
    const ring = fp.find((g) => g.kind === 'townHall')!.ring
    expect(pointInRing(hall.lat, hall.lon, ring)).toBe(true)
  })

  it('keeps nothing in a coarse tile, and round-trips through the codec and the world', () => {
    expect(tileToOsm(bytes(), T, { coarse: true }).grounds).toBeUndefined()
    const data = tileToOsm(bytes(), T)
    const back = decodeOsm(JSON.parse(JSON.stringify(encodeOsm(data))))
    expect(back.grounds).toHaveLength(data.grounds!.length)
    for (const [i, g] of data.grounds!.entries()) {
      expect(back.grounds![i]!.kind).toBe(g.kind)
      expect(back.grounds![i]!.mode).toBe(g.mode)
      back.grounds![i]!.ring.forEach((v, k) => expect(v).toBeCloseTo(g.ring[k]!, 5))
    }
    const wd = new WorldData()
    expect(wd.addGrounds(data.grounds)).toBe(true)
    expect(wd.addGrounds(data.grounds)).toBe(false)
    expect(wd.grounds).toHaveLength(data.grounds!.length)
  })

  it('maps landuse classes to kinds', () => {
    expect(groundKind('university')).toBe('university')
    expect(groundKind('college')).toBe('university')
    expect(groundKind('school')).toBe('school')
    expect(groundKind('hospital')).toBe('hospital')
    expect(groundKind('kindergarten')).toBeUndefined()
    expect(groundKind('residential')).toBeUndefined()
  })
})

describe('linkSights', () => {
  const uni: Sight = { kind: 'university', lat: O.lat, lon: O.lon, name: 'A' }
  const g = (ring: number[], mode: Ground['mode'] = 'grounds', kind: Ground['kind'] = 'university'): Ground => ({ kind, mode, ring })

  it('links a sight to the grounds that contain it, and to the nearest of its kind within 60 m', () => {
    const near = destination(O, 90, 400)
    const out = linkSights([uni, { ...uni, name: 'B', lat: near.lat, lon: near.lon }], [g(square(O, 100)), g(square(near, 100))])
    expect(out).toHaveLength(2)
    expect(out.every((s) => s.area?.mode === 'grounds')).toBe(true)
    const outside = destination(O, 0, 130)
    const edge = linkSights([{ ...uni, lat: outside.lat, lon: outside.lon }], [g(square(O, 100))])
    expect(edge[0]!.area).toBeDefined()
    const far = destination(O, 0, 200)
    expect(linkSights([{ ...uni, lat: far.lat, lon: far.lon }], [g(square(O, 100))])[0]!.area).toBeUndefined()
  })

  it('ignores grounds of another kind, and falls back to the footprint', () => {
    expect(linkSights([uni], [g(square(O, 100), 'grounds', 'school')])[0]!.area).toBeUndefined()
    const out = linkSights([uni], [g(square(O, 20), 'footprint')])
    expect(out[0]!.area?.mode).toBe('footprint')
  })

  it('merges sights that share grounds into the most important one, in any input order', () => {
    const a: Sight = { ...uni, name: 'Campus', rank: 1 }
    const nb = destination(O, 90, 50)
    const b: Sight = { ...uni, name: 'Faculty', rank: 90, lat: nb.lat, lon: nb.lon }
    const grounds = [g(square(O, 120))]
    expect(linkSights([a, b], grounds).map((s) => s.name)).toEqual(['Campus'])
    expect(linkSights([b, a], grounds).map((s) => s.name)).toEqual(['Campus'])
  })

  it('joins pieces cut at a tile edge by their shared end points', () => {
    const left = g([39.47, -0.377, 39.47, -0.376, 39.471, -0.376, 39.471, -0.377])
    const right = g([39.47, -0.376, 39.47, -0.375, 39.471, -0.375, 39.471, -0.376])
    const lone = g([39.48, -0.37, 39.48, -0.369, 39.481, -0.369])
    expect(groupPieces([left, right, lone]).map((x) => x.length).sort()).toEqual([1, 2])
    const p: Sight = { kind: 'university', lat: 39.4705, lon: -0.3765 }
    const out = linkSights([p], [left, right])
    expect(out[0]!.area?.rings).toHaveLength(2)
  })

  it('leaves monuments alone and returns the sights unchanged without areas', () => {
    const tower: Sight = { kind: 'tower', lat: O.lat, lon: O.lon, monument: 'castle', name: 'T' }
    expect(linkSights([tower], [g(square(O, 100))])[0]!.area).toBeUndefined()
    expect(linkSights([uni], undefined)).toEqual([uni])
  })
})

describe('route to grounds (L2)', () => {
  const ROUTE: LatLon[] = [O, destination(O, 90, 500), destination(O, 90, 1000)]
  const campusAt = (sideM: number): LinkedSight => {
    const c = destination(destination(O, 90, 500), sideM >= 0 ? 0 : 180, Math.abs(sideM))
    return { kind: 'university', lat: c.lat, lon: c.lon, area: { mode: 'grounds', rings: [square(c, 100)] } }
  }

  it('shows a campus whose edge is within 50 m of the route although its point is much farther', () => {
    // Centre 140 m off the route: the edge is 40 m away.
    const near = sightsAlongRoute([campusAt(140)], ROUTE)
    expect(near).toHaveLength(1)
    expect(near[0]!.lateralM).toBeGreaterThan(30)
    expect(near[0]!.lateralM).toBeLessThanOrEqual(50)
    expect(near[0]!.area?.mode).toBe('grounds')
    expect(sightsAlongRoute([campusAt(170)], ROUTE)).toHaveLength(0)
  })

  it('shows a campus the route runs through, at distance 0', () => {
    const marks = sightsAlongRoute([campusAt(20)], ROUTE)
    expect(marks[0]!.lateralM).toBe(0)
  })

  it('property: shown exactly when the grounds are within the corridor', () => {
    fc.assert(
      fc.property(fc.integer({ min: -260, max: 260 }), (side) => {
        const s = campusAt(side)
        const shown = sightsAlongRoute([s], ROUTE).length === 1
        const d = Math.max(0, Math.abs(side) - 100)
        if (d > 52) expect(shown).toBe(false)
        if (d < 48) expect(shown).toBe(true)
      }),
    )
  })
})

describe('geometry', () => {
  it('tests points against a ring and measures distance to its edge', () => {
    const ring = square(O, 50)
    expect(pointInRing(O.lat, O.lon, ring)).toBe(true)
    const out = destination(O, 90, 80)
    expect(pointInRing(out.lat, out.lon, ring)).toBe(false)
    expect(distanceToRingM(out.lat, out.lon, ring)).toBeCloseTo(30, 0)
  })
})
