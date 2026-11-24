import { LocalProjection } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'

/**
 * Safety and name enrichment of a tile-built walking graph (map-rendering requirement 23.5).
 *
 * Tiles give geometry only: no `lit`, no sidewalks, no names per way. An Overpass extract of the same
 * place has them. This matches each tile way to the Overpass way it lies on and hands over the `safety`
 * flags and the street name. Geometry never moves; a tile way that matches nothing keeps what it has,
 * which is the default of an Overpass way without tags (flags 0). Pure.
 */

/** A tile way follows an Overpass way when its sample points lie within this distance of it. */
export const MATCH_DIST_M = 6
/** ... and run within this angle of it (parallel, either direction). */
export const MATCH_ANGLE_DEG = 25
/** At least this share of a tile way's samples must agree on one Overpass way. */
export const MATCH_SHARE = 0.5
/** Long segments get a sample about this often, metres. */
const SAMPLE_EVERY_M = 12
const INDEX_CELL_M = 16

export type Tagged = { safety: number; name?: string }
type Geometry = { lat: ArrayLike<number>; lon: ArrayLike<number>; ways: readonly OsmWay[] }

/**
 * For each way index of `which` in `base`, the tags of the Overpass way of `extra` it follows (only
 * ways that carry flags or a name count). A way that gains nothing is left out of the result.
 */
export function matchTags(base: Geometry, which: Iterable<number>, extra: OsmData): Map<number, Tagged> {
  const out = new Map<number, Tagged>()
  const tagged: number[] = []
  extra.ways.forEach((w, k) => {
    if (w.walkable && !w.area && w.nodes.length > 1 && ((w.safety ?? 0) !== 0 || w.name)) tagged.push(k)
  })
  if (!tagged.length) return out
  const proj = new LocalProjection({ lat: (extra.bbox.north + extra.bbox.south) / 2, lon: (extra.bbox.east + extra.bbox.west) / 2 })
  type Seg = { way: number; ax: number; ay: number; bx: number; by: number; angle: number }
  const grid = new Map<string, Seg[]>()
  const key = (x: number, y: number) => `${Math.floor(x / INDEX_CELL_M)},${Math.floor(y / INDEX_CELL_M)}`
  for (const k of tagged) {
    const w = extra.ways[k]!
    for (let i = 1; i < w.nodes.length; i++) {
      const a = proj.toXY({ lat: extra.lat[w.nodes[i - 1]!]!, lon: extra.lon[w.nodes[i - 1]!]! })
      const b = proj.toXY({ lat: extra.lat[w.nodes[i]!]!, lon: extra.lon[w.nodes[i]!]! })
      const seg: Seg = { way: k, ax: a.x, ay: a.y, bx: b.x, by: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) }
      const x0 = Math.floor((Math.min(a.x, b.x) - MATCH_DIST_M) / INDEX_CELL_M)
      const x1 = Math.floor((Math.max(a.x, b.x) + MATCH_DIST_M) / INDEX_CELL_M)
      const y0 = Math.floor((Math.min(a.y, b.y) - MATCH_DIST_M) / INDEX_CELL_M)
      const y1 = Math.floor((Math.max(a.y, b.y) + MATCH_DIST_M) / INDEX_CELL_M)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const g = `${x},${y}`
          const list = grid.get(g)
          if (list) list.push(seg)
          else grid.set(g, [seg])
        }
      }
    }
  }
  const maxAngle = (MATCH_ANGLE_DEG * Math.PI) / 180
  for (const index of which) {
    const w = base.ways[index]
    if (!w || !w.walkable || w.nodes.length < 2) continue
    const votes = new Map<number, number>()
    let samples = 0
    for (let i = 1; i < w.nodes.length; i++) {
      const a = proj.toXY({ lat: base.lat[w.nodes[i - 1]!]!, lon: base.lon[w.nodes[i - 1]!]! })
      const b = proj.toXY({ lat: base.lat[w.nodes[i]!]!, lon: base.lon[w.nodes[i]!]! })
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      const n = Math.max(1, Math.round(len / SAMPLE_EVERY_M))
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n
        const px = a.x + (b.x - a.x) * t
        const py = a.y + (b.y - a.y) * t
        samples++
        let best: { d: number; way: number } | undefined
        for (const seg of grid.get(key(px, py)) ?? []) {
          let diff = Math.abs(seg.angle - angle) % Math.PI
          if (diff > Math.PI / 2) diff = Math.PI - diff
          if (diff > maxAngle) continue
          const dx = seg.bx - seg.ax
          const dy = seg.by - seg.ay
          const l2 = dx * dx + dy * dy
          const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - seg.ax) * dx + (py - seg.ay) * dy) / l2))
          const d = Math.hypot(seg.ax + u * dx - px, seg.ay + u * dy - py)
          if (d <= MATCH_DIST_M && (!best || d < best.d)) best = { d, way: seg.way }
        }
        if (best) votes.set(best.way, (votes.get(best.way) ?? 0) + 1)
      }
    }
    let top: { way: number; n: number } | undefined
    for (const [way, n] of votes) if (!top || n > top.n) top = { way, n }
    if (!top || top.n < samples * MATCH_SHARE) continue
    const source = extra.ways[top.way]!
    out.set(index, { safety: source.safety ?? 0, ...(source.name ? { name: source.name } : {}) })
  }
  return out
}
