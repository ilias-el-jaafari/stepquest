import { insidePolygon } from '../osm/roundabout.ts'

type XY = { x: number; y: number }

/** Rings with more nodes than this are thinned (evenly) before chords are looked for, so the cost stays bounded. */
export const MAX_PLAZA_NODES = 60
/** Interior points of a chord that must lie inside the polygon. */
const SAMPLES = [0.2, 0.4, 0.5, 0.6, 0.8]

/** Proper crossing of segments p1-p2 and q1-q2 (shared end points and touching do not count). */
function crosses(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  const d = (a: XY, b: XY, c: XY) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(q1, q2, p1)
  const d2 = d(q1, q2, p2)
  const d3 = d(p1, p2, q1)
  const d4 = d(p1, p2, q2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * Walkable shortcuts across a pedestrian plaza: pairs of ring vertices (indices
 * into `ring`, an open ring: no repeated first point) whose straight chord
 * stays inside the polygon. A chord is kept when it crosses no ring edge and
 * the points sampled along it are all inside, so concave plazas are never cut
 * across their notches. Ring neighbours are skipped (the ring edge exists).
 * Pure; O(n² · n) on at most `MAX_PLAZA_NODES` vertices.
 */
export function plazaChords(ring: readonly XY[]): [number, number][] {
  const n = ring.length
  if (n < 4) return []
  const step = Math.max(1, Math.ceil(n / MAX_PLAZA_NODES))
  const pick: number[] = []
  for (let i = 0; i < n; i += step) pick.push(i)
  const out: [number, number][] = []
  for (let u = 0; u < pick.length; u++) {
    for (let v = u + 1; v < pick.length; v++) {
      const i = pick[u]!
      const j = pick[v]!
      if (j - i === 1 || (i === 0 && j === n - 1)) continue
      const a = ring[i]!
      const b = ring[j]!
      if (a.x === b.x && a.y === b.y) continue
      let ok = true
      for (let k = 0; k < n && ok; k++) {
        const e1 = ring[k]!
        const e2 = ring[(k + 1) % n]!
        if (crosses(a, b, e1, e2)) ok = false
      }
      if (!ok) continue
      for (const t of SAMPLES) {
        if (!insidePolygon({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ring)) {
          ok = false
          break
        }
      }
      if (ok) out.push([i, j])
    }
  }
  return out
}
