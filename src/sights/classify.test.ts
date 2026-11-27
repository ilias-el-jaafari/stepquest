import { describe, expect, it } from 'vitest'
import { dedupeSights, monumentStyle, sightFromPoi, sightFromTags, sightScore, worshipKind } from './classify.ts'
import type { Sight } from './types.ts'

const P = { lat: 39.47, lon: -0.376 }
const poi = (props: Record<string, unknown>) => sightFromPoi(props, P.lat, P.lon)

describe('places of worship by religion', () => {
  it.each([
    ['christian', 'church'],
    ['muslim', 'mosque'],
    ['jewish', 'synagogue'],
    ['buddhist', 'temple'],
    ['hindu', 'temple'],
    ['sikh', 'temple'],
    ['', 'temple'],
    [undefined, 'temple'],
    ['something_new', 'temple'],
  ])('%s -> %s', (religion, kind) => {
    expect(worshipKind(religion)).toBe(kind)
    expect(poi({ class: 'place_of_worship', subclass: religion, name: 'X' })?.kind).toBe(kind)
    expect(sightFromTags({ amenity: 'place_of_worship', ...(religion ? { religion } : {}) }, P.lat, P.lon)?.kind).toBe(kind)
  })
})

describe('OpenMapTiles poi classification', () => {
  it('maps faculties, schools, hospitals and the town hall', () => {
    expect(poi({ class: 'college', subclass: 'university', name: 'Universitat' })?.kind).toBe('university')
    expect(poi({ class: 'college', subclass: 'college' })?.kind).toBe('university')
    expect(poi({ class: 'school', subclass: 'school', name: 'CEIP', rank: 6 })).toMatchObject({ kind: 'school', name: 'CEIP', rank: 6 })
    expect(poi({ class: 'hospital', subclass: 'hospital' })?.kind).toBe('hospital')
    expect(poi({ class: 'town_hall', subclass: 'townhall', name: 'Ajuntament' })?.kind).toBe('townHall')
  })

  it('leaves out kindergartens, clinics, community centres, courts, artworks and shops', () => {
    for (const p of [
      { class: 'school', subclass: 'kindergarten' },
      { class: 'hospital', subclass: 'clinic' },
      { class: 'town_hall', subclass: 'community_centre' },
      { class: 'town_hall', subclass: 'courthouse' },
      { class: 'art_gallery', subclass: 'artwork', name: 'Falla' },
      { class: 'shop', subclass: 'supermarket' },
      {},
    ]) {
      expect(poi(p)).toBeUndefined()
    }
  })

  it('only counts named monuments, with their class and a design', () => {
    expect(poi({ class: 'monument', subclass: 'monument' })).toBeUndefined()
    expect(poi({ class: 'monument', subclass: 'monument', name: 'Monumento a Augusto' })).toMatchObject({ monument: 'monument', kind: 'statue' })
    expect(poi({ class: 'castle', subclass: 'ruins', name: 'Puerta de los Judios' })).toMatchObject({ monument: 'castle', kind: 'arch' })
    expect(poi({ class: 'attraction', subclass: 'attraction', name: 'Torre del Reloj' })?.kind).toBe('tower')
  })
})

describe('OSM tags', () => {
  it('reads amenities, wikidata and wikipedia', () => {
    expect(sightFromTags({ amenity: 'townhall', name: 'Ayuntamiento' }, P.lat, P.lon)?.kind).toBe('townHall')
    expect(sightFromTags({ amenity: 'college' }, P.lat, P.lon)?.kind).toBe('university')
    expect(sightFromTags({ building: 'mosque' }, P.lat, P.lon)?.kind).toBe('mosque')
    expect(sightFromTags({ tourism: 'attraction', name: 'Fuente Grande', wikidata: 'Q1', wikipedia: 'es:Fuente' }, P.lat, P.lon)).toMatchObject({ kind: 'fountain', wikidata: true, wikipedia: true })
    expect(sightFromTags({ historic: 'memorial', name: 'Memorial' }, P.lat, P.lon)).toMatchObject({ monument: 'memorial' })
    expect(sightFromTags({ tourism: 'attraction' }, P.lat, P.lon)).toBeUndefined()
    expect(sightFromTags({ shop: 'bakery' }, P.lat, P.lon)).toBeUndefined()
  })
})

describe('monument design and score', () => {
  it('picks a design from the name, then the class, then stably from the name', () => {
    expect(monumentStyle('attraction', 'Fuente de la Plaza')).toBe('fountain')
    expect(monumentStyle('attraction', 'Arco de Triunfo')).toBe('arch')
    expect(monumentStyle('monument', 'Las Torres')).toBe('tower')
    expect(monumentStyle('castle', 'Algo')).toBe('tower')
    expect(monumentStyle('ruins', 'Cosa vieja')).toBe(monumentStyle('ruins', 'Cosa vieja'))
  })

  it('scores class, name, links and rank', () => {
    const base: Sight = { kind: 'statue', lat: 0, lon: 0, monument: 'monument' }
    expect(sightScore({ ...base, name: 'A' })).toBeGreaterThan(sightScore(base))
    expect(sightScore({ ...base, name: 'A', wikidata: true, wikipedia: true })).toBe(sightScore({ ...base, name: 'A' }) + 50)
    expect(sightScore({ ...base, rank: 1 })).toBeGreaterThan(sightScore({ ...base, rank: 150 }))
    expect(sightScore({ ...base, monument: 'castle' })).toBeGreaterThan(sightScore({ ...base, monument: 'ruins' }))
  })
})

describe('dedupeSights', () => {
  it('merges the same kind within 80 m, keeps the more important, and ignores input order', () => {
    const a: Sight = { kind: 'hospital', lat: 39.47, lon: -0.376, name: 'Hospital A', rank: 5 }
    const b: Sight = { kind: 'hospital', lat: 39.4703, lon: -0.376, rank: 1 }
    const c: Sight = { kind: 'school', lat: 39.47, lon: -0.376 }
    const x = dedupeSights([a, b, c])
    const y = dedupeSights([c, b, a])
    expect(x).toEqual(y)
    expect(x).toHaveLength(2)
    expect(x.find((s) => s.kind === 'hospital')?.name).toBe('Hospital A')
  })
})
