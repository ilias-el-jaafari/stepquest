import type { BBox } from '../geo/geo.ts'
import { cellKey, cellOf } from './cells.ts'

export const boxContains = (b: BBox, lat: number, lon: number): boolean => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east

export const boxArea = (b: BBox): number => Math.max(0, b.north - b.south) * Math.max(0, b.east - b.west)

/** The overlap of two boxes, or undefined when they share no area. */
export function intersectBoxes(a: BBox, b: BBox): BBox | undefined {
  const r = { south: Math.max(a.south, b.south), west: Math.max(a.west, b.west), north: Math.min(a.north, b.north), east: Math.min(a.east, b.east) }
  return r.south < r.north && r.west < r.east ? r : undefined
}

/**
 * A fast "is this point inside the loaded map" test. With no `coverage` it is the bounding box
 * (a single extract). With coverage (one box per cell) it looks the point's cell up, so the cost does
 * not grow with the number of loaded cells; a point on a shared edge also tries the cells to its
 * south and west, so it is inside when either side is loaded.
 */
export function makeInside(data: { bbox: BBox; coverage?: readonly BBox[] }): (lat: number, lon: number) => boolean {
  const coverage = data.coverage
  if (!coverage) {
    const b = data.bbox
    return (lat, lon) => boxContains(b, lat, lon)
  }
  const byCell = new Map<string, BBox[]>()
  for (const b of coverage) {
    // A coverage box lies in one cell; its centre names it.
    const key = cellKey(cellOf({ lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 }))
    const list = byCell.get(key)
    if (list) list.push(b)
    else byCell.set(key, [b])
  }
  const hit = (i: number, j: number, lat: number, lon: number) => byCell.get(`${i},${j}`)?.some((b) => boxContains(b, lat, lon)) ?? false
  return (lat, lon) => {
    const { i, j } = cellOf({ lat, lon })
    return hit(i, j, lat, lon) || hit(i - 1, j, lat, lon) || hit(i, j - 1, lat, lon) || hit(i - 1, j - 1, lat, lon)
  }
}

/** The bounding box of a set of boxes. */
export function unionBox(boxes: readonly BBox[]): BBox {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const b of boxes) {
    south = Math.min(south, b.south)
    west = Math.min(west, b.west)
    north = Math.max(north, b.north)
    east = Math.max(east, b.east)
  }
  return { south, west, north, east }
}
