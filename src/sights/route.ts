import { LocalProjection, haversine, type LatLon } from '../geo/geo.ts'
import { compareSights } from './classify.ts'
import { CORRIDOR_M, PASS_M, isMonumentKind, sightId, type Sight, type SightMark } from './types.ts'

/**
 * The sights of a route: which lie along it, which two monuments count, which the hero has passed and
 * which one Wisp should point out next. Pure; the order of the input never changes the answer.
 */

/** The two (or `n`) most representative monument candidates of `sights`. */
export function topMonuments(sights: readonly Sight[], n = 2): Sight[] {
  return sights.filter((s) => isMonumentKind(s.kind)).sort(compareSights).slice(0, n)
}

/**
 * The marks of the sights within `corridorM` of the route polyline, in route order. Monuments are kept
 * only when `monuments` holds them (the quest's two), when it is given.
 */
export function sightsAlongRoute(sights: readonly Sight[], route: readonly LatLon[], corridorM = CORRIDOR_M, monuments?: ReadonlySet<string>): SightMark[] {
  const first = route[0]
  if (!first || sights.length === 0) return []
  const proj = new LocalProjection(first)
  const xs = new Float64Array(route.length)
  const ys = new Float64Array(route.length)
  const cum = new Float64Array(route.length)
  for (let i = 0; i < route.length; i++) {
    const p = proj.toXY(route[i]!)
    xs[i] = p.x
    ys[i] = p.y
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!)
  }
  const marks: SightMark[] = []
  for (const s of sights) {
    const id = sightId(s)
    if (isMonumentKind(s.kind) && monuments && !monuments.has(id)) continue
    const q = proj.toXY(s)
    let best = Infinity
    let along = 0
    const last = Math.max(0, route.length - 2)
    for (let i = 0; i <= last; i++) {
      const ax = xs[i]!
      const ay = ys[i]!
      const bx = xs[i + 1] ?? ax
      const by = ys[i + 1] ?? ay
      // A segment farther than the corridor in either axis cannot be the closest: skip the maths.
      if (Math.min(ax, bx) - q.x > corridorM || q.x - Math.max(ax, bx) > corridorM || Math.min(ay, by) - q.y > corridorM || q.y - Math.max(ay, by) > corridorM) continue
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.y - ay) * dy) / len2)) : 0
      const d = Math.hypot(q.x - (ax + t * dx), q.y - (ay + t * dy))
      if (d < best) {
        best = d
        along = cum[i]! + t * Math.sqrt(len2)
      }
    }
    if (best > corridorM) continue
    marks.push({ id, kind: s.kind, lat: s.lat, lon: s.lon, ...(s.name ? { name: s.name } : {}), alongM: along, lateralM: best })
  }
  return marks.sort((a, b) => a.alongM - b.alongM || (a.id < b.id ? -1 : 1))
}

/** The sights the hero has walked past: the route progress has reached their closest point. */
export function passedSights(marks: readonly SightMark[], alongM: number): SightMark[] {
  return marks.filter((m) => m.alongM <= alongM)
}

/** The nearest mark within `passM` of the player that has not been announced yet. */
export function announceNext(player: LatLon, marks: readonly SightMark[], announced: ReadonlySet<string>, passM = PASS_M): SightMark | undefined {
  let best: SightMark | undefined
  let bestD = passM
  for (const m of marks) {
    if (announced.has(m.id)) continue
    const d = haversine(player, m)
    if (d <= bestD) {
      best = m
      bestD = d
    }
  }
  return best
}
