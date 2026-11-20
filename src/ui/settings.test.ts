import { beforeEach, describe, expect, it } from 'vitest'
import { clampSteps, DEFAULT_SETTINGS, loadSettings, parseCoords, sanitizeSettings, saveSettings } from './settings.ts'

describe('settings', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to a 10,000-step loop with a 0.75 m stride', () => {
    expect(loadSettings()).toEqual({ mode: 'loop', targetSteps: 10_000, strideM: 0.75 })
  })
  it('persists and reloads', () => {
    saveSettings({ mode: 'oneway', targetSteps: 6000, strideM: 0.7 })
    expect(loadSettings()).toEqual({ mode: 'oneway', targetSteps: 6000, strideM: 0.7 })
  })
  it('sanitizes garbage', () => {
    expect(sanitizeSettings({ mode: 'fly', targetSteps: 'x', strideM: 9 })).toEqual({ ...DEFAULT_SETTINGS, strideM: 1.2 })
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(clampSteps(10)).toBe(100)
    expect(clampSteps(1e9)).toBe(60_000)
  })
  it('parses coordinates', () => {
    expect(parseCoords('39.4935, -0.3920')).toEqual({ lat: 39.4935, lon: -0.392 })
    expect(parseCoords('40.4168 -3.7038')).toEqual({ lat: 40.4168, lon: -3.7038 })
    expect(parseCoords('hello')).toBeUndefined()
    expect(parseCoords('91, 0')).toBeUndefined()
  })
})
