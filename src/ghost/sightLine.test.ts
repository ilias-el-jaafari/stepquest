import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { SIGHT_KINDS } from '../sights/types.ts'
import { SIGHT_NAME_MAX, sightLine } from './director.ts'

describe('sightLine', () => {
  it('has a plain line in both languages for every kind, short enough for the bubble', () => {
    for (const k of SIGHT_KINDS) {
      const key = `ghost.sight.${k}` as keyof typeof en
      expect(sightLine({ kind: k }).key).toBe(key)
      for (const dict of [en, es]) {
        expect(dict[key]).toBeTruthy()
        expect([...dict[key]].length).toBeLessThanOrEqual(45)
      }
      expect(es[`sight.kind.${k}` as keyof typeof es]).toBeTruthy()
      expect(en[`sight.kind.${k}` as keyof typeof en]).toBeTruthy()
    }
    expect(en['ghost.sight.townHall']).toBe('Look, the Town Hall!')
    expect(es['ghost.sight.townHall']).toBe('¡Mira, el Ayuntamiento!')
  })

  it('names universities, schools, hospitals and monuments when there is a name', () => {
    expect(sightLine({ kind: 'university', name: 'Facultat' })).toMatchObject({ key: 'ghost.sightNamed.university', name: 'Facultat' })
    expect(sightLine({ kind: 'fountain', name: 'Fuente' }).key).toBe('ghost.sightNamed.monument')
    expect(sightLine({ kind: 'university' }).key).toBe('ghost.sight.university')
    expect(sightLine({ kind: 'church', name: 'San Pedro' })).toEqual({ key: 'ghost.sight.church', pose: 'float', ms: 3800 })
  })

  it('cuts a long name', () => {
    const line = sightLine({ kind: 'university', name: 'Universidad Internacional de Valencia sede grande' })
    expect([...line.name!].length).toBeLessThanOrEqual(SIGHT_NAME_MAX)
    expect(line.name!.endsWith('…')).toBe(true)
  })
})
