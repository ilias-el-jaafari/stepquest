import { describe, expect, it } from 'vitest'
import { parseCoords } from '../ui/settings.ts'
import { formatCoord, formatCoordPair } from './coords.ts'

describe('coordinates', () => {
  it('keep the decimal point and round to the requested digits', () => {
    expect(formatCoord(39.49351234)).toBe('39.4935')
    expect(formatCoord(-0.392, 2)).toBe('-0.39')
  })
  it('round-trip through the coordinates field parser', () => {
    const p = { lat: 39.4935, lon: -0.392 }
    expect(parseCoords(formatCoordPair(p))).toEqual(p)
  })
})
