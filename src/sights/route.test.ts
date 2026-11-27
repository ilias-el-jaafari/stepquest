import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { announceNext, passedSights, sightsAlongRoute, topMonuments } from './route.ts'
import { CORRIDOR_M, PASS_M, sightId, type Sight, type SightKind } from './types.ts'

const O: LatLon = { lat: 39.47, lon: -0.376 }
/** A straight route 1 km east of O. */
const ROUTE: LatLon[] = [O, destination(O, 90, 500), destination(O, 90, 1000)]
const at = (alongM: number, sideM: number, kind: SightKind = 'school', extra: Partial<Sight> = {}): Sight => {
  const p = destination(destination(O, 90, alongM), sideM >= 0 ? 0 : 180, Math.abs(sideM))
  return { kind, lat: p.lat, lon: p.lon, ...extra }
}

describe('sightsAlongRoute', () => {
  it('keeps what is within the corridor, with its place along the route, in route order', () => {
    const marks = sightsAlongRoute([at(800, 30), at(200, -10, 'hospital'), at(500, 80), at(1200, 0)], ROUTE)
    expect(marks.map((m) => m.kind)).toEqual(['hospital', 'school'])
    expect(marks[0]!.alongM).toBeCloseTo(200, -1)
    expect(marks[0]!.lateralM).toBeCloseTo(10, 0)
    expect(marks[1]!.alongM).toBeCloseTo(800, -1)
  })

  it('shows nothing without a route', () => {
    expect(sightsAlongRoute([at(10, 0)], [])).toEqual([])
    expect(sightsAlongRoute([], ROUTE)).toEqual([])
  })

  it('keeps a monument only when it is one of the chosen two', () => {
    const m1 = at(100, 0, 'tower', { monument: 'castle', name: 'A' })
    const m2 = at(300, 0, 'arch', { monument: 'monument', name: 'B' })
    const marks = sightsAlongRoute([m1, m2], ROUTE, CORRIDOR_M, new Set([sightId(m2)]))
    expect(marks.map((m) => m.id)).toEqual([sightId(m2)])
  })

  it('property: shown only inside the corridor, none beyond', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ along: fc.integer({ min: -300, max: 1300 }), side: fc.integer({ min: -400, max: 400 }) }), { maxLength: 40 }),
        (items) => {
          const sights = items.map((i) => at(i.along, i.side))
          const marks = sightsAlongRoute(sights, ROUTE)
          const shown = new Set(marks.map((m) => m.id))
          for (const m of marks) expect(m.lateralM).toBeLessThanOrEqual(CORRIDOR_M)
          for (const s of sights) {
            // Distance to the nearest route point sampled every metre is an upper bound of the real distance.
            let nearest = Infinity
            for (let d = 0; d <= 1000; d += 1) nearest = Math.min(nearest, haversine(s, destination(O, 90, d)))
            if (nearest > CORRIDOR_M + 1) expect(shown.has(sightId(s))).toBe(false)
            if (nearest < CORRIDOR_M - 1) expect(shown.has(sightId(s))).toBe(true)
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})

describe('topMonuments', () => {
  const mk = (name: string, monument: Sight['monument'], rank: number, extra: Partial<Sight> = {}): Sight => ({ kind: 'statue', lat: 39.4 + rank / 1000, lon: -0.3, name, monument, rank, ...extra })
  const pool: Sight[] = [mk('Castle', 'castle', 50), mk('Statue', 'monument', 10), mk('Famous', 'memorial', 5, { wikidata: true, wikipedia: true }), mk('Ruin', 'ruins', 100), { kind: 'school', lat: 39.4, lon: -0.3, name: 'School' }]

  it('takes the two highest scores and ignores other kinds', () => {
    const top = topMonuments(pool)
    expect(top).toHaveLength(2)
    expect(top.map((s) => s.name)).toEqual(['Famous', 'Castle'])
  })

  it('is the same for every order of the input (property)', () => {
    const expected = topMonuments(pool).map(sightId)
    fc.assert(
      fc.property(fc.shuffledSubarray(pool, { minLength: pool.length, maxLength: pool.length }), (shuffled) => {
        expect(topMonuments(shuffled).map(sightId)).toEqual(expected)
      }),
    )
  })

  it('breaks exact ties by name, then position', () => {
    const a = mk('B', 'monument', 10)
    const b = mk('A', 'monument', 10, { lat: 40 })
    expect(topMonuments([a, b], 1)[0]!.name).toBe('A')
  })
})

describe('passedSights and announceNext', () => {
  const marks = sightsAlongRoute([at(100, 10), at(400, 20, 'hospital'), at(700, 45, 'church')], ROUTE)

  it('lists the sights the progress has reached', () => {
    expect(passedSights(marks, 0)).toEqual([])
    expect(passedSights(marks, 450).map((m) => m.kind)).toEqual(['school', 'hospital'])
    expect(passedSights(marks, 1000)).toHaveLength(3)
  })

  it('announces each sight once, only within the pass radius, nearest first', () => {
    const announced = new Set<string>()
    const hero = destination(O, 90, 100)
    expect(announceNext(destination(O, 90, 250), marks, announced)).toBeUndefined()
    const first = announceNext(hero, marks, announced)
    expect(first?.kind).toBe('school')
    announced.add(first!.id)
    expect(announceNext(hero, marks, announced)).toBeUndefined()
    // The church lies 45 m off the route: beyond the pass radius from the route itself.
    expect(announceNext(destination(O, 90, 700), marks, announced)).toBeUndefined()
    expect(PASS_M).toBeLessThan(CORRIDOR_M)
  })

  it('mentions a sight only when it is on screen: about 35 m, while sights are still drawn out to 50 m', () => {
    expect(PASS_M).toBe(35)
    expect(CORRIDOR_M).toBe(50)
    const near = sightsAlongRoute([at(300, 30)], ROUTE)
    const far = sightsAlongRoute([at(300, 42)], ROUTE)
    expect(near).toHaveLength(1)
    expect(far).toHaveLength(1)
    const hero = destination(O, 90, 300)
    expect(announceNext(hero, near, new Set())).toBeDefined()
    expect(announceNext(hero, far, new Set())).toBeUndefined()
  })

  it('property: a walk along the route announces every sight inside the pass radius exactly once', () => {
    const announced = new Set<string>()
    const said: string[] = []
    for (let d = 0; d <= 1000; d += 5) {
      const m = announceNext(destination(O, 90, d), marks, announced)
      if (m) {
        announced.add(m.id)
        said.push(m.id)
      }
    }
    expect(said).toHaveLength(new Set(said).size)
    expect(said).toEqual(marks.filter((m) => m.lateralM < PASS_M - 2).map((m) => m.id))
  })
})
