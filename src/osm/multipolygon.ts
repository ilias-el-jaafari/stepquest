/**
 * Multipolygon assembly (pure). An OSM multipolygon relation lists member ways
 * with a role: `outer` ways form the outline, `inner` ways cut holes
 * (courtyards, ponds). One ring is often split over several ways, and members
 * of an `out geom` answer carry coordinates but no node ids, so ways are joined
 * where their end points have identical coordinates.
 */

export type LatLonPoint = { lat: number; lon: number }
export type Ring = LatLonPoint[]

const same = (a: LatLonPoint, b: LatLonPoint) => a.lat === b.lat && a.lon === b.lon
const key = (p: LatLonPoint) => `${p.lat},${p.lon}`

/**
 * Join open and closed member ways into closed rings. Chains that do not close
 * (the other half of the ring lies outside the downloaded data) are dropped.
 * The result repeats the first point at the end. Never loops forever: every
 * step consumes a segment.
 */
export function assembleRings(segments: readonly Ring[]): Ring[] {
  const rings: Ring[] = []
  const open: Ring[] = []
  for (const seg of segments) {
    const pts = seg.filter((p, i) => i === 0 || !same(p, seg[i - 1]!))
    if (pts.length < 2) continue
    if (pts.length >= 4 && same(pts[0]!, pts[pts.length - 1]!)) rings.push(pts)
    else open.push(pts)
  }
  // Index open chains by both end points.
  const ends = new Map<string, number[]>()
  const unused = new Set<number>()
  open.forEach((chain, i) => {
    unused.add(i)
    for (const p of [chain[0]!, chain[chain.length - 1]!]) {
      const list = ends.get(key(p))
      if (list) list.push(i)
      else ends.set(key(p), [i])
    }
  })
  /** Append the next unused chain that touches the tail; false when none does. */
  const extend = (chain: Ring): boolean => {
    const tail = chain[chain.length - 1]!
    for (const i of ends.get(key(tail)) ?? []) {
      if (!unused.has(i)) continue
      unused.delete(i)
      const part = open[i]!
      const ordered = same(part[0]!, tail) ? part : part.slice().reverse()
      for (let k = 1; k < ordered.length; k++) chain.push(ordered[k]!)
      return true
    }
    return false
  }
  for (let start = 0; start < open.length; start++) {
    if (!unused.has(start)) continue
    unused.delete(start)
    const chain = open[start]!.slice()
    const closed = () => chain.length >= 4 && same(chain[0]!, chain[chain.length - 1]!)
    while (!closed() && extend(chain));
    if (!closed()) {
      chain.reverse()
      while (!closed() && extend(chain));
    }
    if (closed()) rings.push(chain)
  }
  return rings
}

/** Even-odd point-in-ring test in lat/lon space (rings are small, planar enough). */
export function ringContains(ring: readonly LatLonPoint[], p: LatLonPoint): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

export type PolygonWithHoles = { outer: Ring; holes: Ring[] }

/**
 * Pair every inner ring with the smallest outer ring that contains it (a hole
 * inside an island inside a lake belongs to the island). Inner rings outside
 * every outer ring are dropped.
 */
export function buildPolygons(outers: readonly Ring[], inners: readonly Ring[]): PolygonWithHoles[] {
  const areaOf = (r: Ring) => {
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]!.lon + r[i]!.lon) * (r[j]!.lat - r[i]!.lat)
    return Math.abs(a / 2)
  }
  const polys: PolygonWithHoles[] = outers.map((outer) => ({ outer, holes: [] }))
  const sizes = outers.map(areaOf)
  for (const inner of inners) {
    let best = -1
    const probe = inner[0]!
    polys.forEach((poly, i) => {
      if (ringContains(poly.outer, probe) && (best < 0 || sizes[i]! < sizes[best]!)) best = i
    })
    if (best >= 0) polys[best]!.holes.push(inner)
  }
  return polys
}
