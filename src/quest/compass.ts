import type { LatLon } from '../geo/geo.ts'
import { bearingBetween } from '../routing/planner.ts'

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type CompassPoint = (typeof COMPASS)[number]
export const ARROWS: Record<CompassPoint, string> = { N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖' }

export function compassPoint(bearingDeg: number): CompassPoint {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8
  return COMPASS[i]!
}

export function directionTo(from: LatLon, to: LatLon): { bearing: number; point: CompassPoint } {
  const bearing = bearingBetween(from, to)
  return { bearing, point: compassPoint(bearing) }
}
