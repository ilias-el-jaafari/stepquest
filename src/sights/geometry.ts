/**
 * Small polygon helpers for sight areas, on flat `[lat, lon, lat, lon, ...]` rings. Distances use a local
 * equirectangular scale (good to a few centimetres over a campus). Pure.
 */

const M_PER_DEG = 111_320

/** True when (lat, lon) is inside the ring (even-odd rule). */
export function pointInRing(lat: number, lon: number, ring: readonly number[]): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[2 * i]!
    const xi = ring[2 * i + 1]!
    const yj = ring[2 * j]!
    const xj = ring[2 * j + 1]!
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Metres from (lat, lon) to the nearest edge of the ring (not the inside test). */
export function distanceToRingM(lat: number, lon: number, ring: readonly number[]): number {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG
  const n = ring.length / 2
  let best = Infinity
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = (ring[2 * j + 1]! - lon) * kx
    const ay = (ring[2 * j]! - lat) * M_PER_DEG
    const bx = (ring[2 * i + 1]! - lon) * kx
    const by = (ring[2 * i]! - lat) * M_PER_DEG
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** Bounding box of a ring: [south, west, north, east]. */
export function ringBox(ring: readonly number[]): [number, number, number, number] {
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (let i = 0; i < ring.length; i += 2) {
    s = Math.min(s, ring[i]!)
    n = Math.max(n, ring[i]!)
    w = Math.min(w, ring[i + 1]!)
    e = Math.max(e, ring[i + 1]!)
  }
  return [s, w, n, e]
}

/** Key of a vertex rounded to 1e-6 degrees: pieces cut at a tile edge share these. */
export const vertexKey = (lat: number, lon: number): string => `${Math.round(lat * 1e6)},${Math.round(lon * 1e6)}`
