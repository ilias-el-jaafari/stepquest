import { describe, expect, it } from 'vitest'
import { commitSteps, commitStride, formatStride, liveSteps, liveStride, parseStepsText, parseStrideText, sliderValue } from './numberInput.ts'

describe('step goal text', () => {
  it('parses plain and grouped numbers', () => {
    expect(parseStepsText('2000')).toEqual({ kind: 'number', value: 2000 })
    expect(parseStepsText(' 12.000 ')).toEqual({ kind: 'number', value: 12_000 })
    expect(parseStepsText('12,000')).toEqual({ kind: 'number', value: 12_000 })
    expect(parseStepsText('12 000')).toEqual({ kind: 'number', value: 12_000 })
    expect(parseStepsText('')).toEqual({ kind: 'empty' })
    expect(parseStepsText('2k')).toEqual({ kind: 'invalid' })
    expect(parseStepsText('-5')).toEqual({ kind: 'invalid' })
  })
  it('never blocks partial input: every prefix of 2000 is accepted as text', () => {
    // Only in-range prefixes become live values; the rest wait for blur.
    expect(['2', '20', '200', '2000'].map(liveSteps)).toEqual([undefined, undefined, 200, 2000])
  })
  it('clamps on commit and says why', () => {
    expect(commitSteps('2000', 10_000)).toEqual({ value: 2000 })
    expect(commitSteps('2', 10_000)).toEqual({ value: 100, note: 'low' })
    expect(commitSteps('99999', 10_000)).toEqual({ value: 60_000, note: 'high' })
    expect(commitSteps('', 8000)).toEqual({ value: 8000, note: 'invalid' })
    expect(commitSteps('abc', 8000)).toEqual({ value: 8000, note: 'invalid' })
    expect(commitSteps('100', 8000)).toEqual({ value: 100 })
    expect(commitSteps('60000', 8000)).toEqual({ value: 60_000 })
  })
  it('maps any goal onto the slider range', () => {
    expect(sliderValue(2000)).toBe(2000)
    expect(sliderValue(2250)).toBe(2500)
    expect(sliderValue(100)).toBe(500)
    expect(sliderValue(45_000)).toBe(30_000)
  })
})

describe('stride text', () => {
  it('accepts a decimal point or comma and partial input', () => {
    expect(parseStrideText('0,8')).toEqual({ kind: 'number', value: 0.8 })
    expect(parseStrideText('0.')).toEqual({ kind: 'number', value: 0 })
    expect(parseStrideText('.7')).toEqual({ kind: 'number', value: 0.7 })
    expect(parseStrideText('0..7')).toEqual({ kind: 'invalid' })
    expect(['0', '0.', '0.8', '0.82'].map(liveStride)).toEqual([undefined, undefined, 0.8, 0.82])
  })
  it('clamps and rounds on commit', () => {
    expect(commitStride('0,7', 0.75)).toEqual({ value: 0.7 })
    expect(commitStride('0.123', 0.75)).toEqual({ value: 0.4, note: 'low' })
    expect(commitStride('0.456', 0.75)).toEqual({ value: 0.46 })
    expect(commitStride('2', 0.75)).toEqual({ value: 1.2, note: 'high' })
    expect(commitStride('', 0.8)).toEqual({ value: 0.8, note: 'invalid' })
    expect(formatStride(0.7)).toBe('0.7')
  })
})
