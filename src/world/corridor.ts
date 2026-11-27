import { haversine, type LatLon } from '../geo/geo.ts'
import { cellDistanceM, cellsInBBox, type CellId } from './cells.ts'
import { walkTiles } from './walkArea.ts'
import type { TileId } from '../vector/tileMath.ts'

/**
 * The streets an A → B walk across the city needs (routing requirement 14): not the box around start and finish, which the
 * 36 km² cap of `areaForWalk` cannot hold beyond about 5 km, but the cells along the line between them. Pure.
 */

/** Walks shorter than this (start to finish, straight) keep the box of `areaForWalk`; longer ones use the corridor. */
export const CORRIDOR_FROM_M = 4_000
/** Half the width of the corridor: at least this, so a detour around a river or a park has streets to use. */
export const CORRIDOR_MIN_HALF_M = 1_000
/** At most this: a goal far longer than the direct way widens the corridor up to here. */
export const CORRIDOR_MAX_HALF_M = 2_000
/** Spacing of the points taken along the line (smaller than a cell, so no cell the line crosses is missed). */
const STEP_M = 150

/** Whether the walk from `start` to `end` is a corridor walk. */
export const isCorridor = (start: LatLon, end: LatLon | undefined): end is LatLon => !!end && haversine(start, end) > CORRIDOR_FROM_M

/**
 * Half the corridor's width for a walk of `targetM`: the room an ellipse with the two ends as foci gives to a route of that length
 * (streets add about 30 %), between the minimum and the maximum.
 */
export function corridorHalfM(directM: number, targetM: number): number {
  const path = targetM / 1.3
  const lateral = path > directM ? Math.sqrt((path / 2) ** 2 - (directM / 2) ** 2) : 0
  return Math.min(CORRIDOR_MAX_HALF_M, Math.max(CORRIDOR_MIN_HALF_M, lateral))
}

/** The cells within the corridor's half width of the straight line from `start` to `end`, nearest the start first. */
export function corridorCells(start: LatLon, end: LatLon, targetM: number): CellId[] {
  const direct = haversine(start, end)
  const half = corridorHalfM(direct, targetM)
  const n = Math.max(1, Math.ceil(direct / STEP_M))
  const samples: LatLon[] = []
  for (let k = 0; k <= n; k++) samples.push({ lat: start.lat + ((end.lat - start.lat) * k) / n, lon: start.lon + ((end.lon - start.lon) * k) / n })
  const padLat = half / 111_320
  const padLon = half / (111_320 * Math.max(0.01, Math.cos((Math.max(Math.abs(start.lat), Math.abs(end.lat)) * Math.PI) / 180)))
  const box = {
    south: Math.min(start.lat, end.lat) - padLat,
    north: Math.max(start.lat, end.lat) + padLat,
    west: Math.min(start.lon, end.lon) - padLon,
    east: Math.max(start.lon, end.lon) + padLon,
  }
  const out: { c: CellId; at: number }[] = []
  for (const c of cellsInBBox(box)) {
    let at = -1
    for (let k = 0; k < samples.length; k++) {
      if (cellDistanceM(c, samples[k]!) <= half) {
        at = k
        break
      }
    }
    if (at >= 0) out.push({ c, at })
  }
  return out.sort((a, b) => a.at - b.at || a.c.i - b.c.i || a.c.j - b.c.j).map((e) => e.c)
}

/** The z14 tiles of the corridor (the download of a corridor walk). */
export const corridorTiles = (start: LatLon, end: LatLon, targetM: number): TileId[] => walkTiles(corridorCells(start, end, targetM))

