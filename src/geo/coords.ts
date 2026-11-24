import type { LatLon } from './geo.ts'

/**
 * Coordinates keep the decimal point in every language: the field that takes them parses a
 * point, and a comma next to the comma between latitude and longitude would be ambiguous.
 */
export function formatCoord(n: number, digits = 4): string {
  return n.toFixed(digits)
}

/** "39.49350, -0.39200", the text of the advanced coordinates field. */
export function formatCoordPair(p: LatLon): string {
  return `${formatCoord(p.lat, 5)}, ${formatCoord(p.lon, 5)}`
}
