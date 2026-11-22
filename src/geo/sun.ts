import type { LatLon } from './geo.ts'

/**
 * Sunrise and sunset from the usual low-precision solar formulas (NOAA /
 * Astronomical Almanac style, accurate to a minute or two), computed on the
 * device: no API.
 */

const RAD = Math.PI / 180
/** The sun's centre is 0.833° below the horizon at sunrise/sunset (refraction + disc). */
const HORIZON = -0.833

function julian(ms: number): number {
  return ms / 86_400_000 + 2_440_587.5
}

/** Declination (rad) and equation of time (minutes) for a moment. */
function solar(ms: number): { decl: number; eqTime: number } {
  const n = julian(ms) - 2_451_545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD
  let diff = L - ((ra + 360) % 360)
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return { decl, eqTime: 4 * diff }
}

/** Sun altitude in degrees above the horizon at a place and moment. */
export function sunAltitude(ms: number, p: LatLon): number {
  const { decl, eqTime } = solar(ms)
  const d = new Date(ms)
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
  const solarMin = utcMin + eqTime + 4 * p.lon
  const hourAngle = (solarMin / 4 - 180) * RAD
  const lat = p.lat * RAD
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD
}

/** Whether it is dark (after sunset, before sunrise) at a place and moment. */
export function isDark(ms: number, p: LatLon): boolean {
  return sunAltitude(ms, p) < HORIZON
}

/**
 * Sunrise and sunset (epoch ms) of the UTC day containing `ms`, or undefined
 * for polar day/night.
 */
export function sunTimes(ms: number, p: LatLon): { sunrise: number; sunset: number } | undefined {
  const day = Math.floor(ms / 86_400_000) * 86_400_000
  // Two passes: the second uses the sun's position at the first estimate of solar noon.
  let noon = day + (720 - 4 * p.lon) * 60_000
  for (let i = 0; i < 2; i++) noon = day + (720 - 4 * p.lon - solar(noon).eqTime) * 60_000
  const { decl } = solar(noon)
  const lat = p.lat * RAD
  const cosH = (Math.sin(HORIZON * RAD) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl))
  if (cosH < -1 || cosH > 1) return undefined
  const h = Math.acos(cosH) / RAD // degrees
  return { sunrise: noon - h * 4 * 60_000, sunset: noon + h * 4 * 60_000 }
}
