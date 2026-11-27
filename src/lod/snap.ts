import type { LatLon } from '../geo/geo.ts'
import { tileBBox } from '../vector/tileMath.ts'
import { CLASS_MASK, NO_FOOT } from './classes.ts'
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
type Candidate = Best & { cls: number }

const M_PER_DEG = 111_320

type Box = { north: number; south: number; west: number; east: number }

/** Nearest point of shape `i` of `g` to `p` (metres around `p`). */
function nearestOfShape(g: LodGeom, box: Box, p: LatLon, i: number): Best | undefined {
  const kx = M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)
  const ky = M_PER_DEG
  const dLat = (box.north - box.south) / LOD_EXTENT
  const dLon = (box.east - box.west) / LOD_EXTENT
  const from = g.start[i]! * 2
  const to = g.start[i + 1]! * 2
  let best: Best | undefined
  for (let j = from + 2; j < to; j += 2) {
    const ay = box.north - g.xy[j - 1]! * dLat
    const ax = box.west + g.xy[j - 2]! * dLon
    const by = box.north - g.xy[j + 1]! * dLat
    const bx = box.west + g.xy[j]! * dLon
    // Metres east and north of p.
    const x1 = (ax - p.lon) * kx
    const y1 = (ay - p.lat) * ky
    const dx = (bx - p.lon) * kx - x1
    const dy = (by - p.lat) * ky - y1
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2))
    const d = Math.hypot(x1 + t * dx, y1 + t * dy)
    if (!best || d < best.d) best = { d, lat: ay + (by - ay) * t, lon: ax + (bx - ax) * t }
  }
  return best
}

/** The walking graph accepts the line (`NO_FOOT` is set by `isWalkable` when the tile is made, see `tile.ts`). */
const walkable = (kind: number): boolean => (kind & NO_FOOT) === 0

/** A name line belongs to a walkable line when it is of the same class and passes this close to the snapped point (both are simplified separately). */
export const NAME_MATCH_M = 4

/** The name of the street line of class `cls` that passes within `NAME_MATCH_M` of `at`, from any of the tiles. */
function nameAt(tiles: readonly LodTile[], at: LatLon, cls: number): string | undefined {
  let best: Best | undefined
  for (const t of tiles) {
    if (distanceToTileM(t.id, at) > NAME_MATCH_M) continue
    const box = tileBBox(t.id)
    const g = t.names
    for (let i = 0; i < g.kind.length; i++) {
      if ((g.kind[i]! & CLASS_MASK) !== cls) continue
      const n = nearestOfShape(g, box, at, i)
      if (n && n.d <= NAME_MATCH_M && (!best || n.d < best.d)) best = { ...n, name: g.text[i] }
    }
  }
  return best?.name
}

/**
 * The street a tap means (requirement 25.7, 26.7): the nearest point of a walkable street line within `maxM` of `p`. Only lines of
 * `transportation` count, and `NO_FOOT` is the rule of the walking graph, so the point is always on a street the planner can use.
 * The name comes from the name line that belongs to that line; a named line within `NAMED_BONUS_M` of the nearest distance wins
 * over an unnamed one. `tiles` are the LOD tiles near the tap (any others are ignored).
 */
export function snapStreet(tiles: readonly LodTile[], p: LatLon, maxM: number): Snap | undefined {
  const found: Candidate[] = []
  for (const t of tiles) {
    if (distanceToTileM(t.id, p) > maxM) continue
    const box = tileBBox(t.id)
    const g = t.streets
    for (let i = 0; i < g.kind.length; i++) {
      if (!walkable(g.kind[i]!)) continue
      const n = nearestOfShape(g, box, p, i)
      if (n && n.d <= maxM) found.push({ ...n, cls: g.kind[i]! & CLASS_MASK })
    }
  }
  if (!found.length) return undefined
  let nearest = found[0]!
  for (const c of found) if (c.d < nearest.d) nearest = c
  let pick: Candidate = nearest
  let name: string | undefined
  for (const c of found.sort((x, y) => x.d - y.d)) {
    if (c.d > nearest.d + NAMED_BONUS_M) break
    const n = nameAt(tiles, c, c.cls)
    if (n) {
      pick = c
      name = n
      break
    }
  }
  return { point: { lat: pick.lat, lon: pick.lon }, ...(name ? { name } : {}), distanceM: pick.d }
}
