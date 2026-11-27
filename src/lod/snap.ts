import type { LatLon } from '../geo/geo.ts'
import { tileBBox } from '../vector/tileMath.ts'
import { CLASS_MASK, NO_FOOT, Street } from './classes.ts'
import { distanceToTileM } from './select.ts'
import { LOD_EXTENT, type LodGeom, type LodTile } from './tile.ts'

/** How far from a tap a street may be and still be chosen (requirement 25.7), in CSS px, with limits in metres. */
export const SNAP_PX = 28
export const SNAP_MIN_M = 12
export const SNAP_MAX_M = 250
/** A named street this much farther than the nearest street still wins. */
export const NAMED_BONUS_M = 12

export type Snap = {
  /** The nearest walkable point of the street. */
  point: LatLon
  /** The street's name as the data has it; absent for a street without one. */
  name?: string
  distanceM: number
}

/** The reach of a tap at `zoom` (CSS px per tile of `metresPerTile`). */
export function snapRadiusM(zoom: number, metresPerTile: number): number {
  const m = (SNAP_PX / Math.max(zoom, 1e-6)) * metresPerTile
  return Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, m))
}

type Best = { d: number; lat: number; lon: number; name?: string }

const M_PER_DEG = 111_320

/** Nearest point of the lines of `g` accepted by `pick` to `p`, in metres around `p`. */
function nearest(g: LodGeom, box: { north: number; south: number; west: number; east: number }, p: LatLon, pick: (i: number) => boolean, text?: string[]): Best | undefined {
  const kx = M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)
  const ky = M_PER_DEG
  const dLat = (box.north - box.south) / LOD_EXTENT
  const dLon = (box.east - box.west) / LOD_EXTENT
  const lat = (uy: number) => box.north - uy * dLat
  const lon = (ux: number) => box.west + ux * dLon
  let best: Best | undefined
  for (let i = 0; i < g.kind.length; i++) {
    if (!pick(i)) continue
    const from = g.start[i]! * 2
    const to = g.start[i + 1]! * 2
    for (let j = from + 2; j < to; j += 2) {
      const ay = lat(g.xy[j - 1]!)
      const ax = lon(g.xy[j - 2]!)
      const by = lat(g.xy[j + 1]!)
      const bx = lon(g.xy[j]!)
      // Metres east and north of p.
      const x1 = (ax - p.lon) * kx
      const y1 = (ay - p.lat) * ky
      const x2 = (bx - p.lon) * kx
      const y2 = (by - p.lat) * ky
      const dx = x2 - x1
      const dy = y2 - y1
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2))
      const d = Math.hypot(x1 + t * dx, y1 + t * dy)
      if (!best || d < best.d) best = { d, lat: ay + (by - ay) * t, lon: ax + (bx - ax) * t, name: text?.[i] }
    }
  }
  return best
}

const walkable = (kind: number): boolean => {
  const cls = kind & CLASS_MASK
  return (kind & NO_FOOT) === 0 && cls !== Street.rail && cls !== Street.busway && cls !== Street.motorway && cls !== Street.trunk
}

/**
 * The street a tap means (requirement 25.7): the nearest walkable street line within `maxM` of `p`, and the name of the nearest
 * named street when it lies within `NAMED_BONUS_M` of that distance. `tiles` are the LOD tiles near the tap (any others are ignored).
 */
export function snapStreet(tiles: readonly LodTile[], p: LatLon, maxM: number): Snap | undefined {
  let any: Best | undefined
  let named: Best | undefined
  for (const t of tiles) {
    if (distanceToTileM(t.id, p) > maxM) continue
    const box = tileBBox(t.id)
    const a = nearest(t.streets, box, p, (i) => walkable(t.streets.kind[i]!))
    if (a && (!any || a.d < any.d)) any = a
    const n = nearest(t.names, box, p, (i) => walkable(t.names.kind[i]!), t.names.text)
    if (n && (!named || n.d < named.d)) named = n
  }
  const pick = named && named.d <= maxM && (!any || named.d <= any.d + NAMED_BONUS_M) ? named : any
  if (!pick || pick.d > maxM) return undefined
  return { point: { lat: pick.lat, lon: pick.lon }, ...(pick.name ? { name: pick.name } : {}), distanceM: pick.d }
}
