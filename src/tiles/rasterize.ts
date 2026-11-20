import type { OsmData, OsmWay } from '../osm/types.ts'
import { Layer, TileGrid } from './grid.ts'

export type Pt = { x: number; y: number }

/**
 * 4-connected line between tile coordinates (continuous, in tile units).
 * Unlike plain Bresenham it never steps diagonally, so a one-tile path stays
 * connected for the 4-neighbour auto-tiler.
 */
export function line4(a: Pt, b: Pt, visit: (tx: number, ty: number) => void): void {
  let x = Math.floor(a.x)
  let y = Math.floor(a.y)
  const endX = Math.floor(b.x)
  const endY = Math.floor(b.y)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const stepX = dx > 0 ? 1 : -1
  const stepY = dy > 0 ? 1 : -1
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy)
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - a.x : a.x - x) * tDeltaX
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - a.y : a.y - y) * tDeltaY
  visit(x, y)
  let guard = Math.abs(endX - x) + Math.abs(endY - y) + 2
  while ((x !== endX || y !== endY) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX
      x += stepX
    } else {
      tMaxY += tDeltaY
      y += stepY
    }
    visit(x, y)
  }
}

/** Mark every tile whose centre lies within `halfWidth` tiles of segment ab. */
export function thickSegment(a: Pt, b: Pt, halfWidth: number, visit: (tx: number, ty: number) => void): void {
  const minX = Math.floor(Math.min(a.x, b.x) - halfWidth)
  const maxX = Math.ceil(Math.max(a.x, b.x) + halfWidth)
  const minY = Math.floor(Math.min(a.y, b.y) - halfWidth)
  const maxY = Math.ceil(Math.max(a.y, b.y) + halfWidth)
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const r2 = halfWidth * halfWidth
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const cx = tx + 0.5
      const cy = ty + 0.5
      let t = len2 === 0 ? 0 : ((cx - a.x) * vx + (cy - a.y) * vy) / len2
      t = Math.max(0, Math.min(1, t))
      const px = a.x + t * vx - cx
      const py = a.y + t * vy - cy
      if (px * px + py * py <= r2) visit(tx, ty)
    }
  }
  // The centre line keeps thin diagonal roads 4-connected.
  line4(a, b, visit)
}

/** Even-odd scanline fill sampled at tile centres. */
export function fillPolygon(points: Pt[], visit: (tx: number, ty: number) => void): void {
  if (points.length < 3) return
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const xs: number[] = []
  for (let ty = Math.floor(minY); ty <= Math.ceil(maxY); ty++) {
    const cy = ty + 0.5
    xs.length = 0
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const pi = points[i]
      const pj = points[j]
      if (!pi || !pj) continue
      if (pi.y > cy !== pj.y > cy) {
        xs.push(pi.x + ((cy - pi.y) * (pj.x - pi.x)) / (pj.y - pi.y))
      }
    }
    xs.sort((m, n) => m - n)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.ceil((xs[k] ?? 0) - 0.5)
      const to = Math.floor((xs[k + 1] ?? 0) - 0.5)
      for (let tx = from; tx <= to; tx++) visit(tx, ty)
    }
  }
}

/** Street width in metres by highway class (both directions plus kerbs). */
export function roadWidthMetres(highway: string | undefined): number {
  switch (highway) {
    case 'motorway':
    case 'trunk':
    case 'primary':
      return 16
    case 'secondary':
    case 'motorway_link':
    case 'trunk_link':
    case 'primary_link':
      return 13
    case 'tertiary':
    case 'secondary_link':
    case 'tertiary_link':
      return 11
    case 'residential':
    case 'unclassified':
    case 'living_street':
    case 'busway':
    case 'road':
      return 9
    case 'service':
      return 6
    default:
      return 5
  }
}

function wayPoints(grid: TileGrid, data: OsmData, way: OsmWay): Pt[] {
  return way.nodes.map((n) => grid.toTileXY({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 }))
}

/** Rasterize all features into the grid's layer bits, then resolve terrain. */
export function rasterizeOsm(grid: TileGrid, data: OsmData): TileGrid {
  const order: Record<OsmWay['kind'], number> = { park: 0, water: 1, waterway: 2, building: 3, road: 4, path: 5 }
  const ways = [...data.ways].sort((a, b) => order[a.kind] - order[b.kind])
  for (const way of ways) {
    if (way.tunnel) continue
    const pts = wayPoints(grid, data, way)
    const mark = (bits: number) => (tx: number, ty: number) => grid.add(tx, ty, bits)
    switch (way.kind) {
      case 'park':
        fillPolygon(pts, mark(Layer.park))
        break
      case 'water':
        fillPolygon(pts, mark(Layer.water))
        break
      case 'building':
        fillPolygon(pts, mark(Layer.building))
        break
      case 'waterway':
        for (let i = 1; i < pts.length; i++) thickSegment(pts[i - 1]!, pts[i]!, 4 / grid.metresPerTile, mark(Layer.water))
        break
      case 'road': {
        if (way.area) {
          fillPolygon(pts, mark(Layer.road))
          break
        }
        const half = roadWidthMetres(way.highway) / 2 / grid.metresPerTile
        for (let i = 1; i < pts.length; i++) thickSegment(pts[i - 1]!, pts[i]!, half, mark(Layer.road))
        break
      }
      case 'path':
        if (way.area) {
          fillPolygon(pts, mark(Layer.path))
          break
        }
        for (let i = 1; i < pts.length; i++) line4(pts[i - 1]!, pts[i]!, mark(way.crossing ? Layer.path | Layer.crossing : Layer.path))
        break
    }
  }
  grid.resolveTerrain()
  return grid
}

export function buildTileGrid(data: OsmData, metresPerTile?: number): TileGrid {
  return rasterizeOsm(new TileGrid(data.bbox, metresPerTile), data)
}
