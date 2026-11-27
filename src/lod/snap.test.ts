import { describe, expect, it } from 'vitest'
import { haversine } from '../geo/geo.ts'
import { tileBBox } from '../vector/tileMath.ts'
import { NAMED_BONUS_M, SNAP_MAX_M, SNAP_MIN_M, snapRadiusM, snapStreet } from './snap.ts'
import { makeLod } from './testing.ts'

const T = { z: 14, x: 8174, y: 6232 }
const box = tileBBox(T)
/** The lat/lon of a point in tile units. */
const at = (ux: number, uy: number) => ({ lat: box.north - (uy / 4096) * (box.north - box.south), lon: box.west + (ux / 4096) * (box.east - box.west) })
const M = 1.89e3 / 4096 // metres per tile unit, about

describe('tap to street (requirement 25.7)', () => {
  const tile = makeLod(T, {
    lines: [
      { cls: 'minor', pts: [[0, 1000], [4096, 1000]] },
      { cls: 'secondary', pts: [[2000, 0], [2000, 4096]] },
      { cls: 'motorway', pts: [[0, 3000], [4096, 3000]] },
      { cls: 'service', pts: [[0, 3500], [4096, 3500]], props: { foot: 'no' } },
      { cls: 'path', sub: 'footway', pts: [[0, 2500], [4096, 2500]] },
    ],
    names: [
      { cls: 'minor', name: 'Calle Mayor', pts: [[0, 1000], [4096, 1000]] },
      { cls: 'secondary', name: 'Avenida del Puerto', pts: [[2000, 0], [2000, 4096]] },
      { cls: 'motorway', name: 'Autovía V-21', pts: [[0, 3000], [4096, 3000]] },
    ],
  })

  it('snaps to the nearest point of the nearest street and returns its name', () => {
    const tap = at(500, 1000 + 40)
    const s = snapStreet([tile], tap, 250)!
    expect(s.name).toBe('Calle Mayor')
    expect(haversine(s.point, at(500, 1000))).toBeLessThan(1)
    expect(s.distanceM).toBeGreaterThan(40 * M * 0.9)
    expect(s.distanceM).toBeLessThan(40 * M * 1.1)
  })

  it('picks the nearer of two streets, and a named one when it is within the bonus of the nearest', () => {
    const near = snapStreet([tile], at(1900, 400), 250)!
    expect(near.name).toBe('Avenida del Puerto')
    // A footway (no name) 5 m from the tap, a named street 12 m away: the name wins, the point is on the named street.
    const t2 = makeLod(T, {
      lines: [{ cls: 'path', sub: 'footway', pts: [[0, 2000], [4096, 2000]] }, { cls: 'minor', pts: [[0, 2000 + 12 / M], [4096, 2000 + 12 / M]] }],
      names: [{ cls: 'minor', name: 'Carrer Nou', pts: [[0, 2000 + 12 / M], [4096, 2000 + 12 / M]] }],
    })
    const s = snapStreet([t2], at(1000, 2000 - 5 / M), 250)!
    expect(s.name).toBe('Carrer Nou')
    // Farther than the bonus: the unnamed footway is the street.
    const far = NAMED_BONUS_M + 10
    const t3 = makeLod(T, {
      lines: [{ cls: 'path', sub: 'footway', pts: [[0, 2000], [4096, 2000]] }, { cls: 'minor', pts: [[0, 2000 + far / M], [4096, 2000 + far / M]] }],
      names: [{ cls: 'minor', name: 'Carrer Nou', pts: [[0, 2000 + far / M], [4096, 2000 + far / M]] }],
    })
    const u = snapStreet([t3], at(1000, 2000 - 1 / M), 250)!
    expect(u.name).toBeUndefined()
    expect(haversine(u.point, at(1000, 2000))).toBeLessThan(1.5)
  })

  it('never snaps to a motorway, a street marked foot=no or rail, even when it is the nearest', () => {
    expect(snapStreet([tile], at(500, 3000 + 5), 100)?.name).not.toBe('Autovía V-21')
    const onlyBad = makeLod(T, { lines: [{ cls: 'motorway', pts: [[0, 100], [4096, 100]] }, { cls: 'service', pts: [[0, 300], [4096, 300]], props: { foot: 'no' } }, { cls: 'rail', sub: 'rail', pts: [[0, 500], [4096, 500]] }], names: [{ cls: 'motorway', name: 'Autovía', pts: [[0, 100], [4096, 100]] }] })
    expect(snapStreet([onlyBad], at(500, 300), 250)).toBeUndefined()
  })

  it('takes the point from a walkable line only: a name line (it has no access tags) never moves the finish onto a road the graph refuses (requirement 26.7)', () => {
    // The field repro: a primary road marked foot=no is the nearest named line; a walkable street lies 60 m away.
    const t = makeLod(T, {
      lines: [
        { cls: 'primary', pts: [[0, 2000], [4096, 2000]], props: { foot: 'no' } },
        { cls: 'tertiary', pts: [[0, 2000 + 60 / M], [4096, 2000 + 60 / M]] },
      ],
      names: [
        { cls: 'primary', name: 'Carretera Bétera - Riba-roja', pts: [[0, 2000], [4096, 2000]] },
        { cls: 'tertiary', name: 'Calle Norte', pts: [[0, 2000 + 60 / M], [4096, 2000 + 60 / M]] },
      ],
    })
    const s = snapStreet([t], at(1000, 2000 - 2 / M), 250)!
    expect(s.name).toBe('Calle Norte')
    expect(haversine(s.point, at(1000, 2000 + 60 / M))).toBeLessThan(1.5)
    // With no walkable line at all there is no snap, even though a name is right under the tap.
    const only = makeLod(T, { lines: [{ cls: 'primary', pts: [[0, 2000], [4096, 2000]], props: { foot: 'no' } }], names: [{ cls: 'primary', name: 'Carretera', pts: [[0, 2000], [4096, 2000]] }] })
    expect(snapStreet([only], at(1000, 2000), 250)).toBeUndefined()
  })

  it('a walkable line takes a name only from a name line of its own class that runs along it', () => {
    const t = makeLod(T, {
      lines: [{ cls: 'minor', pts: [[0, 2000], [4096, 2000]] }],
      names: [{ cls: 'minor', name: 'Elsewhere', pts: [[0, 2000 + 30 / M], [4096, 2000 + 30 / M]] }, { cls: 'secondary', name: 'Other class', pts: [[0, 2000], [4096, 2000]] }],
    })
    expect(snapStreet([t], at(1000, 2000 - 3 / M), 250)!.name).toBeUndefined()
  })

  it('the walking graph rule decides: a trunk with foot=yes is a street, a cycleway or a use_sidepath road is not', () => {
    const t = makeLod(T, {
      lines: [
        { cls: 'trunk', pts: [[0, 1000], [4096, 1000]], props: { foot: 'yes' } },
        { cls: 'path', sub: 'cycleway', pts: [[0, 2000], [4096, 2000]] },
        { cls: 'primary', pts: [[0, 3000], [4096, 3000]], props: { foot: 'use_sidepath' } },
      ],
    })
    expect(snapStreet([t], at(1000, 1000), 30)).toBeDefined()
    expect(snapStreet([t], at(1000, 2000), 30)).toBeUndefined()
    expect(snapStreet([t], at(1000, 3000), 30)).toBeUndefined()
  })

  it('finds nothing beyond the reach, and ignores tiles that are far away', () => {
    expect(snapStreet([tile], at(500, 1000 + 400), 20)).toBeUndefined()
    const far = { lat: box.north + 0.5, lon: box.west }
    expect(snapStreet([tile], far, 250)).toBeUndefined()
    expect(snapStreet([], at(1, 1), 250)).toBeUndefined()
  })

  it('works across a tile seam: the street of the neighbour is found', () => {
    const left = makeLod({ ...T, x: T.x - 1 }, { lines: [{ cls: 'minor', pts: [[0, 2048], [4096, 2048]] }], names: [{ cls: 'minor', name: 'Carrer Llarg', pts: [[0, 2048], [4096, 2048]] }] })
    const tap = at(10, 2048 + 20)
    const s = snapStreet([tile, left], tap, 250)!
    expect(s.name).toBe('Carrer Llarg')
  })

  it('reaches further the more the map is zoomed out, within limits', () => {
    expect(snapRadiusM(0.5, 5)).toBe(SNAP_MAX_M)
    expect(snapRadiusM(24, 5)).toBe(SNAP_MIN_M)
    expect(snapRadiusM(4, 5)).toBeCloseTo(35, 5)
    expect(snapRadiusM(2, 5) > snapRadiusM(4, 5)).toBe(true)
  })
})
