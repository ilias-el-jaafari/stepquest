import { SETTINGS_STORAGE_KEY } from '../config/brand.ts'
import { clampStride, DEFAULT_STRIDE_M, MAX_STEPS, MIN_STEPS } from '../geo/steps.ts'
import type { RouteMode } from '../routing/planner.ts'

export type Settings = {
  mode: RouteMode
  targetSteps: number
  strideM: number
  /** Safety-weighted routing (on by default). */
  safeRoute: boolean
  /** Weigh lighting more when the walk falls after sunset. */
  nightAware: boolean
}

export const DEFAULT_SETTINGS: Settings = { mode: 'loop', targetSteps: 10_000, strideM: DEFAULT_STRIDE_M, safeRoute: true, nightAware: true }

export function clampSteps(steps: number): number {
  if (!Number.isFinite(steps)) return DEFAULT_SETTINGS.targetSteps
  return Math.round(Math.min(MAX_STEPS, Math.max(MIN_STEPS, steps)))
}

export function sanitizeSettings(raw: unknown): Settings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  return {
    mode: value.mode === 'oneway' ? 'oneway' : 'loop',
    targetSteps: typeof value.targetSteps === 'number' ? clampSteps(value.targetSteps) : DEFAULT_SETTINGS.targetSteps,
    strideM: typeof value.strideM === 'number' ? clampStride(value.strideM) : DEFAULT_SETTINGS.strideM,
    safeRoute: typeof value.safeRoute === 'boolean' ? value.safeRoute : DEFAULT_SETTINGS.safeRoute,
    nightAware: typeof value.nightAware === 'boolean' ? value.nightAware : DEFAULT_SETTINGS.nightAware,
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private mode can block storage; settings simply won't persist.
  }
}

/** Parse "39.4935, -0.3920" (comma, space or semicolon separated). */
export function parseCoords(text: string): { lat: number; lon: number } | undefined {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean)
  if (parts.length !== 2) return undefined
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return undefined
  return { lat, lon }
}
