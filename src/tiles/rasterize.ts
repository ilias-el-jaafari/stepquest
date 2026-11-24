import { SAFETY_LIT, type OsmData, type OsmWay } from '../osm/types.ts'
import { BARRIERS, BUILDING_STYLES, Layer, PARK_STYLES, TileGrid } from './grid.ts'

export type Pt = { x: number; y: number }

/** Tile rectangle that painting is limited to (the grid), so features far outside it cost nothing. */
export type Bounds = { cols: number; rows: number }

const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y)

/**
 * 4-connected line between tile coordinates (continuous, in tile units).
 * Unlike plain Bresenham it never steps diagonally, so a one-tile path stays
 * connected for the 4-neighbour auto-tiler.
 */
export function line4(a: Pt, b: Pt, visit: (tx: number, ty: number) => void, bounds?: Bounds): void {
  if (!finite(a) || !finite(b)) return
  if (bounds) {
    // A segment that leaves the grid is cut one tile outside it, so a 100 km way costs the same as the part we draw.
    const clipped = clipSegment(a, b, -1, -1, bounds.cols + 1, bounds.rows + 1)
    if (!clipped) return
    a = clipped[0]
    b = clipped[1]
  }
  let x = Math.floor(a.x)
  let y = Math.floor(a.y)
  const endX = Math.floor(b.x)
  const endY = Math.floor(b.y)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy)
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - a.x : a.x - x) * tDeltaX
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - a.y : a.y - y) * tDeltaY
  visit(x, y)
  // Always step towards the end tile: rounding (or a denormal slope, where the
  // step distances turn into NaN) can no longer send the line the wrong way.
  let guard = Math.abs(endX - x) + Math.abs(endY - y) + 2
  while ((x !== endX || y !== endY) && guard-- > 0) {
    if (x !== endX && (y === endY || tMaxX < tMaxY)) {
      tMaxX += tDeltaX
      x += endX > x ? 1 : -1
    } else {
      tMaxY += tDeltaY
      y += endY > y ? 1 : -1
    }
    visit(x, y)
  }
}

/** Liang–Barsky clip of segment ab to a rectangle; null when it misses. Points inside are returned unchanged. */
export function clipSegment(a: Pt, b: Pt, x0: number, y0: number, x1: number, y1: number): [Pt, Pt] | null {
  const inside = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
  if (inside(a) && inside(b)) return [a, b]
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  if (t0 > t1) return null
  return [t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy }, t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy }]
}

/**
 * Mark every tile whose centre lies within `halfWidth` tiles of segment ab.
 * Only the tiles of each row that the capsule can reach are tested, so a long
 * diagonal costs about length × width instead of length². With `bounds`,
 * tiles outside the grid are never visited.
 */
export function thickSegment(a: Pt, b: Pt, halfWidth: number, visit: (tx: number, ty: number) => void, bounds?: Bounds): void {
  if (!finite(a) || !finite(b)) return
  let minX = Math.floor(Math.min(a.x, b.x) - halfWidth)
  let maxX = Math.ceil(Math.max(a.x, b.x) + halfWidth)
  let minY = Math.floor(Math.min(a.y, b.y) - halfWidth)
  let maxY = Math.ceil(Math.max(a.y, b.y) + halfWidth)
  if (bounds) {
    minX = Math.max(minX, 0)
    minY = Math.max(minY, 0)
    maxX = Math.min(maxX, bounds.cols - 1)
    maxY = Math.min(maxY, bounds.rows - 1)
  }
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const len = Math.sqrt(len2)
  const r2 = halfWidth * halfWidth
  for (let ty = minY; ty <= maxY; ty++) {
    const cy = ty + 0.5
    // Reachable columns on this row: the strip around the infinite line (the
    // capsule lies inside it), widened by one tile; the exact test below decides.
    let from = minX
    let to = maxX
    if (Math.abs(vy) > 1e-9) {
      const mid = a.x + ((cy - a.y) * vx) / vy
      const reach = (halfWidth * len) / Math.abs(vy) + 1
      if (Number.isFinite(mid) && Number.isFinite(reach)) {
        from = Math.max(from, Math.floor(mid - reach))
        to = Math.min(to, Math.ceil(mid + reach))
      }
    }
    for (let tx = from; tx <= to; tx++) {
      const cx = tx + 0.5
      let t = len2 === 0 ? 0 : ((cx - a.x) * vx + (cy - a.y) * vy) / len2
      t = Math.max(0, Math.min(1, t))
      const px = a.x + t * vx - cx
      const py = a.y + t * vy - cy
      if (px * px + py * py <= r2) visit(tx, ty)
    }
  }
  // The centre line keeps thin diagonal roads 4-connected.
  line4(a, b, visit, bounds)
}

/**
 * Even-odd scanline fill sampled at tile centres, for one ring or several at
 * once: later rings cut holes out of earlier ones (a courtyard inside a
 * building, a pond inside a park). Each ring closes implicitly. Self-crossing
 * outlines follow the even-odd rule, so a figure eight fills both loops and a
 * bow-tie leaves no sliver. Crossings are bucketed per row (cost ~ edges ×
 * rows crossed), and rows and columns outside `bounds` are skipped.
 */
export function fillRings(rings: readonly (readonly Pt[])[], visit: (tx: number, ty: number) => void, bounds?: Bounds): void {
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const p of ring) {
      if (!finite(p)) return
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  if (minY === Infinity) return
  const rowLo = Math.max(bounds ? 0 : -Infinity, Math.floor(minY))
  const rowHi = Math.min(bounds ? bounds.rows - 1 : Infinity, Math.ceil(maxY))
  if (rowHi < rowLo) return
  const crossings: number[][] = Array.from({ length: rowHi - rowLo + 1 }, () => [])
  for (const points of rings) {
        if (points.length < 3 || collinear(points)) continue
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const pi = points[i]!
      const pj = points[j]!
      if (pi.y === pj.y) continue // horizontal edges never cross a row centre
      const lo = Math.min(pi.y, pj.y)
      const hi = Math.max(pi.y, pj.y)
      // Rows whose centre cy satisfies lo <= cy < hi (the half-open rule of the classic test).
      const first = Math.max(rowLo, Math.ceil(lo - 0.5))
      const last = Math.min(rowHi, Math.ceil(hi - 0.5) - 1)
      for (let ty = first; ty <= last; ty++) {
        const cy = ty + 0.5
        crossings[ty - rowLo]!.push(pi.x + ((cy - pi.y) * (pj.x - pi.x)) / (pj.y - pi.y))
      }
    }
  }
  for (let r = 0; r < crossings.length; r++) {
    const xs = crossings[r]!
    xs.sort((m, n) => m - n)
    const ty = rowLo + r
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let from = Math.ceil(xs[k]! - 0.5)
      let to = Math.floor(xs[k + 1]! - 0.5)
      if (bounds) {
        from = Math.max(from, 0)
        to = Math.min(to, bounds.cols - 1)
      }
      for (let tx = from; tx <= to; tx++) visit(tx, ty)
    }
  }
}

/** All corners on one line (or one point): such a ring would paint the tiles whose centres it touches. */
function collinear(points: readonly Pt[]): boolean {
  const p0 = points[0]!
  let far = p0
  let best = 0
  for (const p of points) {
    const d = (p.x - p0.x) ** 2 + (p.y - p0.y) ** 2
    if (d > best) {
      best = d
      far = p
    }
  }
  if (best === 0) return true
  const len = Math.sqrt(best)
  return points.every((p) => Math.abs((far.x - p0.x) * (p.y - p0.y) - (far.y - p0.y) * (p.x - p0.x)) / len < 1e-9)
}

/** Even-odd scanline fill of one ring sampled at tile centres (see {@link fillRings}). */
export function fillPolygon(points: readonly Pt[], visit: (tx: number, ty: number) => void, bounds?: Bounds): void {
  fillRings([points], visit, bounds)
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
  return ringPoints(grid, data, way.nodes)
}

function ringPoints(grid: TileGrid, data: OsmData, nodes: readonly number[]): Pt[] {
  return nodes.map((n) => grid.toTileXY({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 }))
}

/**
 * Cut rail polylines where a bridge carries a road or path over them: the
 * tracks pass underneath, so they are not drawn on top of the bridge deck. A
 * polyline that touches no bridge tile is returned untouched.
 */
export function cutRailsAtBridges(rails: readonly Pt[][], bridge: (tx: number, ty: number) => boolean): Pt[][] {
  const out: Pt[][] = []
  for (const rail of rails) {
    let touches = false
    for (let i = 1; i < rail.length && !touches; i++) line4(rail[i - 1]!, rail[i]!, (tx, ty) => (touches ||= bridge(tx, ty)))
    if (!touches) {
      out.push(rail)
      continue
    }
    // Walk the line in steps of at most half a tile and keep the stretches that are not under a deck.
    let run: Pt[] = []
    const flush = () => {
      if (run.length >= 2) out.push(run)
      run = []
    }
    for (let i = 1; i < rail.length; i++) {
      const a = rail[i - 1]!
      const b = rail[i]!
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2))
      for (let k = 0; k < steps; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }
        const q = { x: a.x + ((b.x - a.x) * (k + 1)) / steps, y: a.y + ((b.y - a.y) * (k + 1)) / steps }
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
        if (bridge(Math.floor(mid.x), Math.floor(mid.y))) {
          flush()
          continue
        }
        if (run.length === 0) run.push(p)
        run.push(q)
      }
    }
    flush()
  }
  return out
}

/**
 * Rasterize all features into the grid's layer bits, then resolve terrain.
 * Painting order (later wins a tile's style): big parks, water, waterways,
 * buildings, roads, paths, barriers. Tunnels are skipped (nothing is drawn
 * over the surface); bridges are painted like any road or path, so they cover
 * water, and they cut the rail overlay underneath. Geometry outside the grid
 * is clipped, so cost follows the area drawn, not the size of the features.
 */
export function rasterizeOsm(grid: TileGrid, data: OsmData): TileGrid {
  const order: Record<OsmWay['kind'], number> = { park: 0, water: 1, waterway: 2, building: 3, road: 4, path: 5, barrier: 6, rail: 7 }
  const bounds: Bounds = { cols: grid.cols, rows: grid.rows }
  // Big parks first so gardens and pitches inside them keep their own style.
  const parkArea = new Map<OsmWay, number>()
  for (const way of data.ways) if (way.kind === 'park') parkArea.set(way, polygonArea(wayPoints(grid, data, way)))
  const ways = [...data.ways].sort((a, b) => order[a.kind] - order[b.kind] || (parkArea.get(b) ?? 0) - (parkArea.get(a) ?? 0))
  for (const way of ways) {
    if (way.tunnel) continue
    const pts = wayPoints(grid, data, way)
    // Outer ring first, then the holes of a multipolygon (even-odd cuts them out).
    const rings = way.holes?.length ? [pts, ...way.holes.map((h) => ringPoints(grid, data, h))] : [pts]
    const mark = (bits: number) => (tx: number, ty: number) => grid.add(tx, ty, bits)
    switch (way.kind) {
      case 'park': {
        const style = Math.max(0, PARK_STYLES.indexOf((way.sub ?? 'park') as (typeof PARK_STYLES)[number]))
        fillRings(
          rings,
          (tx, ty) => {
            grid.add(tx, ty, Layer.park)
            grid.set(grid.style, tx, ty, style)
          },
          bounds,
        )
        break
      }
      case 'barrier': {
        const kind = Math.max(0, BARRIERS.indexOf((way.sub ?? 'fence') as (typeof BARRIERS)[number]))
        for (let i = 1; i < pts.length; i++) line4(pts[i - 1]!, pts[i]!, (tx, ty) => grid.set(grid.barrier, tx, ty, kind || 1), bounds)
        break
      }
      case 'water':
        fillRings(rings, mark(Layer.water), bounds)
        break
      case 'building': {
        const style = Math.max(0, BUILDING_STYLES.indexOf((way.sub ?? 'block') as (typeof BUILDING_STYLES)[number]))
        fillRings(
          rings,
          (tx, ty) => {
            grid.add(tx, ty, Layer.building)
            if (style) grid.set(grid.style, tx, ty, style)
          },
          bounds,
        )
        break
      }
      case 'waterway':
        for (let i = 1; i < pts.length; i++) thickSegment(pts[i - 1]!, pts[i]!, 4 / grid.metresPerTile, mark(Layer.water), bounds)
        break
      case 'road': {
        if (way.area) {
          fillRings(rings, mark(Layer.road), bounds)
          break
        }
        const half = roadWidthMetres(way.highway) / 2 / grid.metresPerTile
        const bits = (way.safety ?? 0) & SAFETY_LIT ? Layer.road | Layer.lit : Layer.road
        const visit = way.bridge
          ? (tx: number, ty: number) => {
              grid.add(tx, ty, bits)
              grid.set(grid.bridge, tx, ty, 1)
            }
          : mark(bits)
        for (let i = 1; i < pts.length; i++) thickSegment(pts[i - 1]!, pts[i]!, half, visit, bounds)
        break
      }
      case 'rail':
        // Drawn as an overlay of sleepers and steel rails (see MapRenderer); never walkable.
        grid.rails.push(pts)
        break
      case 'path': {
        if (way.area) {
          fillRings(rings, mark(way.sub === 'plaza' ? Layer.plaza : Layer.path), bounds)
          break
        }
        const bits = way.crossing ? Layer.path | Layer.crossing : Layer.path
        const visit = way.bridge
          ? (tx: number, ty: number) => {
              grid.add(tx, ty, bits)
              grid.set(grid.bridge, tx, ty, 1)
            }
          : mark(bits)
        for (let i = 1; i < pts.length; i++) line4(pts[i - 1]!, pts[i]!, visit, bounds)
        break
      }
    }
  }
  if (grid.rails.length && data.ways.some((w) => w.bridge)) grid.rails = cutRailsAtBridges(grid.rails, (tx, ty) => grid.bridgeAt(tx, ty))
  grid.resolveTerrain()
  grid.pois = data.pois ?? []
  return grid
}

/** Shoelace area in tile units² (absolute). */
export function polygonArea(points: Pt[]): number {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y)
  return Math.abs(a / 2)
}

export function buildTileGrid(data: OsmData, metresPerTile?: number): TileGrid {
  return rasterizeOsm(new TileGrid(data.bbox, metresPerTile), data)
}
