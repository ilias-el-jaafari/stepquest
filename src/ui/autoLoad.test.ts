import { describe, expect, it } from 'vitest'
import { bboxAround } from '../geo/geo.ts'
import { shouldAutoLoad, type AutoLoadInput } from './autoLoad.ts'

const here = { lat: 39.49, lon: -0.39 }
const bbox = bboxAround(here, 1000)
const far = { lat: 39.52, lon: -0.39 }
const input: AutoLoadInput = { bbox, centre: far, busy: false, hasPlan: false, failedAt: undefined }

describe('shouldAutoLoad', () => {
  it('loads when the map rests outside the loaded area', () => {
    expect(shouldAutoLoad(input)).toBe(true)
  })
  it('does nothing inside the area or without a view', () => {
    expect(shouldAutoLoad({ ...input, centre: here })).toBe(false)
    expect(shouldAutoLoad({ ...input, centre: undefined })).toBe(false)
  })
  it('never starts a second download or replaces a plan or quest', () => {
    expect(shouldAutoLoad({ ...input, busy: true })).toBe(false)
    expect(shouldAutoLoad({ ...input, hasPlan: true })).toBe(false)
  })
  it('does not retry a failed spot, but tries a new one', () => {
    expect(shouldAutoLoad({ ...input, failedAt: { lat: far.lat + 0.001, lon: far.lon } })).toBe(false)
    expect(shouldAutoLoad({ ...input, failedAt: { lat: far.lat + 0.02, lon: far.lon } })).toBe(true)
  })
})
