import { LocalProjection } from '../geo/geo.ts'
import type { OsmData } from './types.ts'

/** A roundabout: its ring (closed chain of node indices) and the island inside it. */
export type Roundabout = {
  /** Indices into OsmData.ways of the ways that make up the ring (one, or several arcs). */
  ways: number[]
  /** Ring nodes in order (first node is not repeated at the end). */
  ring: number[]
  /** Ring in local metres (x east, y south), for point-in-polygon tests. */
  xy: { x: number; y: number }[]
}

/** Geometric detection limits for rings that carry no junction=roundabout tag. */
const MIN_PERIMETER_M = 20
const MAX_PERIMETER_M = 220
const MIN_CIRCULARITY = 0.75
const MIN_RING_NODES = 4

const isRing = (nodes: number[]) => nodes.length >= MIN_RING_NODES + 1 && nodes[0] === nodes[nodes.length - 1]

/**
 * Find roundabouts in two ways:
 * 1. Tagged (junction=roundabout / circular, `way.roundabout`): OSM usually
 *    splits the ring into arcs at every entry, so arcs that join end to end
 *    into a closed cycle are stitched back into one ring.
 * 2. Untagged: a single small, round, closed road loop (perimeter 20-220 m,
 *    circularity above 0.75). Service roads are skipped so car-park loops
 *    stay walkable.
 */
export function findRoundabouts(data: OsmData): Roundabout[] {
  const proj = new LocalProjection({ lat: (data.bbox.north + data.bbox.south) / 2, lon: (data.bbox.east + data.bbox.west) / 2 })
  const toXY = (nodes: number[]) =>
    nodes.map((n) => {
      const p = proj.toXY({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 })
      return { x: p.x, y: p.y }
    })
  const out: Roundabout[] = []
  const tagged: number[] = []
  data.ways.forEach((way, index) => {
    if (way.kind !== 'road' || way.area || way.tunnel) return
    if (way.roundabout) {
      tagged.push(index)
      return
    }
    if (!isRing(way.nodes) || way.highway === 'service' || !way.walkable) return
    const ring = way.nodes.slice(0, -1)
    const xy = toXY(ring)
    let perimeter = 0
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i]!
      const b = xy[(i + 1) % xy.length]!
      perimeter += Math.hypot(b.x - a.x, b.y - a.y)
    }
    if (perimeter < MIN_PERIMETER_M || perimeter > MAX_PERIMETER_M) return
    if ((4 * Math.PI * Math.abs(polygonArea(xy))) / (perimeter * perimeter) < MIN_CIRCULARITY) return
    out.push({ ways: [index], ring, xy })
  })
  for (const cycle of stitchRings(tagged.map((i) => ({ index: i, nodes: data.ways[i]!.nodes })))) {
    if (cycle.ring.length >= 3) out.push({ ways: cycle.ways, ring: cycle.ring, xy: toXY(cycle.ring) })
  }
  return out
}

/** Join ways end to end into closed cycles (every node used by exactly two segments). */
export function stitchRings(ways: { index: number; nodes: number[] }[]): { ways: number[]; ring: number[] }[] {
  type Seg = { a: number; b: number; way: number }
  const segs: Seg[] = []
  const at = new Map<number, number[]>()
  for (const w of ways) {
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1]!
      const b = w.nodes[i]!
      if (a === b) continue
      const id = segs.length
      segs.push({ a, b, way: w.index })
      for (const n of [a, b]) at.set(n, [...(at.get(n) ?? []), id])
    }
  }
  const seen = new Set<number>()
  const out: { ways: number[]; ring: number[] }[] = []
  for (let s = 0; s < segs.length; s++) {
    if (seen.has(s)) continue
    // Collect the connected component of segments.
    const comp: number[] = []
    const stack = [s]
    seen.add(s)
    while (stack.length) {
      const id = stack.pop()!
      comp.push(id)
      for (const n of [segs[id]!.a, segs[id]!.b]) {
        for (const o of at.get(n) ?? []) {
          if (seen.has(o)) continue
          seen.add(o)
          stack.push(o)
        }
      }
    }
    const closedCycle = comp.every((id) => (at.get(segs[id]!.a)?.length ?? 0) === 2 && (at.get(segs[id]!.b)?.length ?? 0) === 2)
    if (!closedCycle) continue
    const first = segs[comp[0]!]!
    const ring = [first.a]
    let node = first.b
    let prev = comp[0]!
    while (node !== first.a && ring.length <= comp.length) {
      ring.push(node)
      const next = (at.get(node) ?? []).find((o) => o !== prev)
      if (next === undefined) break
      const sg = segs[next]!
      node = sg.a === node ? sg.b : sg.a
      prev = next
    }
    if (node === first.a && ring.length === comp.length) out.push({ ways: [...new Set(comp.map((id) => segs[id]!.way))], ring })
  }
  return out
}

export function polygonArea(xy: readonly { x: number; y: number }[]): number {
  let s = 0
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!
    const b = xy[(i + 1) % xy.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

/** Even-odd point-in-polygon test. */
export function insidePolygon(p: { x: number; y: number }, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const SAMPLES = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]
/** Keep sample points this far (m) from the ring so edges that hug the ring are not cut. */
const EDGE_MARGIN_M = 0.5

/**
 * Whether the segment a-b runs through the island of any roundabout: some
 * point strictly between its ends lies inside the ring. Segments that are
 * ring edges are never inside (their samples sit on the boundary and the
 * caller skips them anyway).
 */
export function crossesIsland(a: { x: number; y: number }, b: { x: number; y: number }, islands: readonly Roundabout[]): boolean {
  for (const island of islands) {
    for (const t of SAMPLES) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (!insidePolygon(p, island.xy)) continue
      if (distanceToRing(p, island.xy) > EDGE_MARGIN_M) return true
    }
  }
  return false
}

function distanceToRing(p: { x: number; y: number }, poly: readonly { x: number; y: number }[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y))
  }
  return best
}
