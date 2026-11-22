import { beforeEach, describe, expect, it } from 'vitest'
import { AVOID_STORAGE_KEY } from '../config/brand.ts'
import { addAvoid, loadAvoid, MAX_AVOID, removeAvoid, sanitizeAvoid, saveAvoid } from './avoidList.ts'

describe('avoid list', () => {
  beforeEach(() => localStorage.clear())
  it('starts empty and survives garbage', () => {
    expect(loadAvoid()).toEqual([])
    localStorage.setItem(AVOID_STORAGE_KEY, '{nope')
    expect(loadAvoid()).toEqual([])
    localStorage.setItem(AVOID_STORAGE_KEY, JSON.stringify({ a: 1 }))
    expect(loadAvoid()).toEqual([])
  })
  it('adds without duplicates (ignoring case and accents) and removes', () => {
    let list = addAvoid([], 'Calle de Burjassot')
    list = addAvoid(list, '  calle de  BURJASSOT ')
    list = addAvoid(list, 'Carrer de Sant José')
    list = addAvoid(list, 'carrer de sant jose')
    expect(list).toEqual(['Calle de Burjassot', 'Carrer de Sant José'])
    expect(removeAvoid(list, 'CALLE DE BURJASSOT')).toEqual(['Carrer de Sant José'])
  })
  it('persists and reloads', () => {
    saveAvoid(['Calle Mayor', 'Callejón Oscuro'])
    expect(loadAvoid()).toEqual(['Calle Mayor', 'Callejón Oscuro'])
  })
  it('drops non-strings, blanks and overflow', () => {
    expect(sanitizeAvoid(['A', 3, '', '   ', null, 'B'])).toEqual(['A', 'B'])
    expect(sanitizeAvoid(Array.from({ length: 80 }, (_, i) => `Street ${i}`))).toHaveLength(MAX_AVOID)
  })
})
