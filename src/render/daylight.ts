import type { LatLon } from '../geo/geo.ts'
import { HORIZON, sunAltitude } from '../geo/sun.ts'

/**
 * Day-cycle lighting model for the map. Everything follows the sun's altitude
 * (the same solar maths that decides "night" for safe routing, `src/geo/sun.ts`),
 * so the picture changes smoothly with real time and place. Pure: no DOM.
 */

export type Phase = 'day' | 'golden' | 'dusk' | 'night'
export type Rgb = readonly [number, number, number]

export type Lighting = {
  /** Sun altitude in degrees. */
  altitude: number
  phase: Phase
  /** Colour multiplied over the map (255,255,255 = no change). */
  tint: Rgb
  /** 0 (full daylight) to 1 (deepest night): 1 - luminance of the tint. */
  darkness: number
  /** Street lamp strength, 0 to 1. */
  lamps: number
  /** Lit house windows strength, 0 to 1. */
  windows: number
}

/** Tint keyframes by sun altitude (degrees, descending). Own palette; luminance falls monotonically with altitude. */
export const TINT_KEYS: readonly (readonly [number, Rgb])[] = [
  [30, [255, 255, 255]],
  [12, [255, 246, 225]],
  [6, [255, 226, 172]], // golden hour
  [0, [255, 196, 150]], // sun on the horizon
  [-4, [214, 160, 190]], // civil twilight, pink-purple
  [-8, [150, 130, 200]], // blue-purple dusk
  [-12, [104, 104, 176]],
  [-18, [84, 92, 156]], // night
]

const GOLDEN_FROM = 12
const DUSK_TO = -12

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function tintAt(altitude: number): Rgb {
  const first = TINT_KEYS[0]!
  const last = TINT_KEYS[TINT_KEYS.length - 1]!
  if (altitude >= first[0]) return first[1]
  if (altitude <= last[0]) return last[1]
  for (let i = 1; i < TINT_KEYS.length; i++) {
    const [a1, c1] = TINT_KEYS[i]!
    if (altitude >= a1) {
      const [a0, c0] = TINT_KEYS[i - 1]!
      const k = (altitude - a1) / (a0 - a1)
      return [0, 1, 2].map((j) => Math.round(c1[j]! + (c0[j]! - c1[j]!) * k)) as unknown as Rgb
    }
  }
  return last[1]
}

export function luminance(c: Rgb): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
}

export function phaseAt(altitude: number): Phase {
  if (altitude >= GOLDEN_FROM) return 'day'
  // Dusk starts at sunset, exactly where safe routing starts treating the walk as night.
  if (altitude >= HORIZON) return 'golden'
  return altitude >= DUSK_TO ? 'dusk' : 'night'
}

export function lightingFromAltitude(altitude: number): Lighting {
  const tint = tintAt(altitude)
  return {
    altitude,
    phase: phaseAt(altitude),
    tint,
    darkness: 1 - luminance(tint),
    lamps: smoothstep(4, -6, altitude),
    windows: smoothstep(2, -8, altitude),
  }
}

export function lightingAt(ms: number, place: LatLon): Lighting {
  return lightingFromAltitude(sunAltitude(ms, place))
}

export function cssRgb(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** `?time=19:45` (also `19.45` or `1945`): minutes since local midnight, or undefined if absent or invalid. */
export function parseTimeParam(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('time')
  const m = raw ? /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(raw.trim()) : null
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  return h < 24 && min < 60 ? h * 60 + min : undefined
}

/** The moment on the same local day as `now` at `minutes` after midnight (the lighting preview clock). */
export function atLocalMinutes(now: number, minutes: number): number {
  const d = new Date(now)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d.getTime()
}
