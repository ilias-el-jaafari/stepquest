import { describe, expect, it } from 'vitest'
import { decodeOsm, encodeOsm, CODEC_VERSION } from '../osm/codec.ts'
import { normalizeOverpass } from '../osm/normalize.ts'
import { tileToOsm } from '../vector/omt.ts'
import { encodeMvt, type FixtureFeature } from '../vector/testing.ts'
import { WorldData } from '../world/worldData.ts'
import { cellFromTiles } from '../vector/assemble.ts'
import { cellOf } from '../world/cells.ts'
import { sightId, type Sight } from './types.ts'

const T = { z: 14, x: 8174, y: 6233 }
const point = (props: Record<string, string | number>, x: number, y: number): FixtureFeature => ({ type: 1, props, geometry: [[[x, y]]] })
const tile = () =>
  encodeMvt([
    {
      name: 'poi',
      features: [
        point({ class: 'place_of_worship', subclass: 'muslim', name: 'Mezquita', rank: 19 }, 1000, 1000),
        point({ class: 'place_of_worship', subclass: 'christian', name: 'Parroquia', rank: 22 }, 2000, 1000),
        point({ class: 'place_of_worship', subclass: 'zoroastrian' }, 3000, 1000),
        point({ class: 'town_hall', subclass: 'townhall', name: 'Ajuntament', rank: 21 }, 1000, 2000),
        point({ class: 'monument', subclass: 'monument', name: 'Monumento a Augusto', rank: 130 }, 2000, 2000),
        point({ class: 'school', subclass: 'kindergarten', name: 'Escoleta' }, 3000, 2000),
        point({ class: 'restaurant', subclass: 'restaurant' }, 3500, 2000),
      ],
    },
  ])

describe('sights from a tile', () => {
  it('reads sights from the poi layer, with religion, names and rank', () => {
    const data = tileToOsm(tile(), T)
    expect(data.sights?.map((s) => s.kind).sort()).toEqual(['church', 'mosque', 'statue', 'temple', 'townHall'])
    expect(data.sights?.find((s) => s.kind === 'mosque')).toMatchObject({ name: 'Mezquita', rank: 19 })
    expect(data.sights?.find((s) => s.kind === 'statue')).toMatchObject({ monument: 'monument' })
  })

  it('has none in a coarse tile', () => {
    expect(tileToOsm(tile(), T, { coarse: true }).sights).toEqual([])
  })
})

describe('codec', () => {
  it('writes the current version and round-trips sights', () => {
    const data = tileToOsm(tile(), T)
    const compact = encodeOsm(data)
    expect(compact.v).toBe(CODEC_VERSION)
    expect(CODEC_VERSION).toBe(6)
    const back = decodeOsm(JSON.parse(JSON.stringify(compact)))
    expect(back.sights).toHaveLength(data.sights!.length)
    for (const s of data.sights!) {
      const same = back.sights!.find((b) => b.kind === s.kind && Math.abs(b.lat - s.lat) < 2e-6 && Math.abs(b.lon - s.lon) < 2e-6)
      expect(same).toMatchObject({ ...(s.name ? { name: s.name } : {}), ...(s.rank !== undefined ? { rank: s.rank } : {}), ...(s.monument ? { monument: s.monument } : {}) })
    }
  })

  it('reads older records (no sights) and keeps the flags', () => {
    const old = { ...encodeOsm(tileToOsm(tile(), T)), v: 4 as const }
    delete (old as { sg?: unknown }).sg
    expect(decodeOsm(old as never).sights).toBeUndefined()
    const s: Sight = { kind: 'tower', lat: 39.5, lon: -0.4, name: 'Torre', monument: 'castle', wikidata: true, wikipedia: true }
    const data = { ...tileToOsm(tile(), T), sights: [s] }
    expect(decodeOsm(encodeOsm(data)).sights![0]).toMatchObject({ wikidata: true, wikipedia: true, monument: 'castle' })
  })
})

describe('merging into the world', () => {
  it('hands each sight to its cell and merges without duplicates', () => {
    const data = tileToOsm(tile(), T)
    const s = data.sights![0]!
    const cell = cellOf(s)
    const rec = cellFromTiles(cell, [{ id: T, data }], true)!
    expect(rec.data.sights?.some((x) => sightId(x) === sightId(s))).toBe(true)
    const world = new WorldData()
    world.addRecord(rec)
    world.addRecord(rec)
    const snap = world.snapshot()
    expect(snap.sights!.filter((x) => sightId(x) === sightId(s))).toHaveLength(1)
  })
})

describe('OSM tags through Overpass', () => {
  it('finds sights in an answer that carries them', () => {
    const json = {
      osm3s: { timestamp_osm_base: 't' },
      elements: [
        { type: 'node', id: 1, lat: 39.47, lon: -0.376, tags: { amenity: 'place_of_worship', religion: 'jewish', name: 'Sinagoga' } },
        { type: 'node', id: 2, lat: 39.4701, lon: -0.3761, tags: { shop: 'bakery' } },
      ],
    }
    const data = normalizeOverpass(json, { south: 39.46, west: -0.39, north: 39.48, east: -0.36 }, 'overpass')
    expect(data.sights).toEqual([{ kind: 'synagogue', lat: 39.47, lon: -0.376, name: 'Sinagoga' }])
  })
})
