import { describe, expect, it } from 'vitest'
import { formatDecimal, formatDistance, formatKm, formatNumber, formatSignedPercent } from './format.ts'

describe('number formatting', () => {
  it('uses the decimal comma in Spanish and the point in English', () => {
    expect(formatDecimal(7.5, 'es', 2)).toBe('7,50')
    expect(formatDecimal(7.5, 'en', 2)).toBe('7.50')
    expect(formatDecimal(0.75, 'es', 2)).toBe('0,75')
    expect(formatDecimal(1.2, 'es', 1)).toBe('1,2')
  })

  it('groups thousands by locale', () => {
    expect(formatNumber(10000, 'en')).toBe('10,000')
    expect(formatNumber(10000, 'es')).toBe('10.000')
    // Spanish does not group four-digit numbers (RAE), so "1234" stays whole.
    expect(formatNumber(1234, 'es')).toBe('1234')
  })

  it('formats kilometres and short distances', () => {
    expect(formatKm(7500, 'es')).toBe('7,50 km')
    expect(formatKm(7500, 'en')).toBe('7.50 km')
    expect(formatDistance(480.4, 'es')).toBe('480 m')
    expect(formatDistance(999.6, 'es')).toBe('1,00 km')
    expect(formatDistance(1000, 'en')).toBe('1.00 km')
    expect(formatDistance(12345, 'es')).toBe('12,35 km')
  })

  it('writes a signed percentage with a real minus sign', () => {
    expect(formatSignedPercent(0.012, 'es')).toEqual({ sign: '+', pct: '1,2' })
    expect(formatSignedPercent(-0.049, 'en')).toEqual({ sign: '−', pct: '4.9' })
    expect(formatSignedPercent(0, 'en')).toEqual({ sign: '+', pct: '0.0' })
  })

  it('never prints "NaN" or "-0"', () => {
    expect(formatDecimal(-0.0001, 'en', 1)).toBe('0.0')
    expect(formatDecimal(Number.NaN, 'en', 1)).toBe('0.0')
    expect(formatDistance(Number.NaN, 'es')).toBe('0 m')
  })
})
