// Test helper: a quest whose walker followed a route for a while and then stepped off it.
import type { LatLon } from '../geo/geo.ts'
import { applyFix, createQuest, trackFor, type QuestState } from './quest.ts'
import type { QuestRoute } from './types.ts'

/** The walker has gone `km` of the route, then stepped 80 m off it. */
export function offRouteQuest(route: QuestRoute, walkM: number): QuestState {
  let q = createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0, id: 'bench' })
  const track = trackFor(route)
  let t = 0
  const feed = (p: LatLon) => (q = applyFix(q, { ...p, accuracy: 5, timestamp: (t += 8000) }).state)
  for (let d = 10; d <= walkM; d += 10) feed(pointAt(track.points, track.cumulative, d))
  const from = q.player!
  const lat = 80 / 111_320
  for (let k = 1; k <= 8; k++) feed({ lat: from.lat + (lat * k) / 8, lon: from.lon })
  for (let k = 1; k <= 8; k++) feed({ lat: from.lat + lat, lon: from.lon + (k * 10) / (111_320 * Math.cos((from.lat * Math.PI) / 180)) })
  return q
}

export function pointAt(points: LatLon[], cumulative: number[], d: number): LatLon {
  let i = 1
  while (i < cumulative.length - 1 && cumulative[i]! < d) i++
  const a = points[i - 1]!
  const b = points[i]!
  const span = Math.max(1e-9, cumulative[i]! - cumulative[i - 1]!)
  const f = Math.min(1, Math.max(0, (d - cumulative[i - 1]!) / span))
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }
}
