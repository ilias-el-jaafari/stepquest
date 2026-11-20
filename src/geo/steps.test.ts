import { describe, expect, it } from 'vitest'
import {
  clampStride,
  DEFAULT_STRIDE_M,
  metresToSteps,
  stepsToMetres,
  strideFromHeightCm,
  withinTolerance,
} from './steps.ts'

describe('steps and distance', () => {
  it('uses a 0.75 m default stride', () => {
    expect(DEFAULT_STRIDE_M).toBe(0.75)
    expect(stepsToMetres(10_000)).toBe(7500)
    expect(metresToSteps(7500)).toBe(10_000)
  })
  it('honours a custom stride', () => {
    expect(stepsToMetres(10_000, 0.7)).toBeCloseTo(7000, 6)
    expect(metresToSteps(7000, 0.7)).toBe(10_000)
  })
  it('round-trips for many targets', () => {
    for (const steps of [500, 1234, 8000, 10_000, 25_000]) {
      expect(metresToSteps(stepsToMetres(steps, 0.8), 0.8)).toBe(steps)
    }
  })
  it('returns zero for non-positive or invalid input', () => {
    expect(stepsToMetres(0)).toBe(0)
    expect(stepsToMetres(-5)).toBe(0)
    expect(stepsToMetres(Number.NaN)).toBe(0)
    expect(metresToSteps(-1)).toBe(0)
  })
  it('clamps absurd strides', () => {
    expect(clampStride(0.1)).toBe(0.4)
    expect(clampStride(3)).toBe(1.2)
    expect(clampStride(Number.NaN)).toBe(DEFAULT_STRIDE_M)
  })
  it('estimates stride from height', () => {
    expect(strideFromHeightCm(180)).toBeCloseTo(0.75, 2)
    expect(strideFromHeightCm(160)).toBeCloseTo(0.66, 2)
  })
  it('checks the ±5% tolerance', () => {
    expect(withinTolerance(7500, 7500)).toBe(true)
    expect(withinTolerance(7870, 7500)).toBe(true)
    expect(withinTolerance(7880, 7500)).toBe(false)
    expect(withinTolerance(7120, 7500)).toBe(false)
    expect(withinTolerance(10, 0)).toBe(false)
  })
})
