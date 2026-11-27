import { LocalProjection, haversine, type LatLon } from '../geo/geo.ts'
import { compareSights } from './classify.ts'
import { CORRIDOR_M, PASS_M, isMonumentKind, sightId, type LinkedSight, type SightMark } from './types.ts'
import { pointInRing } from './geometry.ts'

/**
 * The sights of a route: which lie along it, which two monuments count, which the hero has passed and
 * which one Wisp should point out next. Pure; the order of the input never changes the answer.
 */

/** The two (or `n`) most representative monument candidates of `sights`. */
export function topMonuments<S extends LinkedSight>(sights: readonly S[], n = 2): S[] {
  return sights.filter((s) => isMonumentKind(s.kind)).sort(compareSights).slice(0, n)
}

/**
 * The marks of the sights within `corridorM` of the route polyline, in route order. Monuments are kept
 * only when `monuments` holds them (the quest's two), when it is given.
 */
export function sightsAlongRoute(sights: readonly LinkedSight[], route: readonly LatLon[], corridorM = CORRIDOR_M, monuments?: ReadonlySet<string>): SightMark[] {
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
    // The area of a sight counts when it has one: the route may run beside or through a campus.
    const queries: { x: number; y: number }[] = []
    let rings: { x: Float64Array; y: Float64Array; ll: number[] }[] = []
    if (s.area) {
      rings = s.area.rings.map((ll) => {
        const x = new Float64Array(ll.length / 2)
        const y = new Float64Array(ll.length / 2)
        for (let k = 0; k < x.length; k++) {
          const p = proj.toXY({ lat: ll[2 * k]!, lon: ll[2 * k + 1]! })
          x[k] = p.x
          y[k] = p.y
          queries.push(p)
        }
        return { x, y, ll }
      })
    } else queries.push(proj.toXY(s))
    let best = Infinity
    let along = 0
    const last = Math.max(0, route.length - 2)
    for (const q of queries) {
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
    }
    // Route points inside the area, or closer to an edge than any vertex was to the route.
    for (const r of rings) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (let k = 0; k < r.x.length; k++) {
        x0 = Math.min(x0, r.x[k]!)
        x1 = Math.max(x1, r.x[k]!)
        y0 = Math.min(y0, r.y[k]!)
        y1 = Math.max(y1, r.y[k]!)
      }
      for (let i = 0; i < route.length; i++) {
        const px = xs[i]!
        const py = ys[i]!
        if (px < x0 - corridorM || px > x1 + corridorM || py < y0 - corridorM || py > y1 + corridorM) continue
        let d = Infinity
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1 && pointInRing(route[i]!.lat, route[i]!.lon, r.ll)) d = 0
        else {
          for (let k = 0, j = r.x.length - 1; k < r.x.length; j = k++) {
            const ex = r.x[k]! - r.x[j]!
            const ey = r.y[k]! - r.y[j]!
            const l2 = ex * ex + ey * ey
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - r.x[j]!) * ex + (py - r.y[j]!) * ey) / l2)) : 0
            d = Math.min(d, Math.hypot(px - (r.x[j]! + t * ex), py - (r.y[j]! + t * ey)))
          }
        }
        if (d < best) {
          best = d
          along = cum[i]!
        }
      }
    }
    if (best > corridorM) continue
    marks.push({ id, kind: s.kind, lat: s.lat, lon: s.lon, ...(s.name ? { name: s.name } : {}), alongM: along, lateralM: best, ...(s.area ? { area: s.area } : {}) })
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
