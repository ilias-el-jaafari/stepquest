import { LocalProjection, type BBox } from '../geo/geo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'

/**
 * The walking network of a set of vector tiles (map-rendering requirement 23, routing requirement 13).
 *
 * Tiles hold streets as lines cut at the tile edge, with no node ids and with some junction vertices
 * simplified away, so two streets that meet do not always share a vertex. This turns the walkable lines
 * of every tile of a request into one network a walking graph can use:
 *
 * 1. points snap to a 1e-6° grid (about 11 cm): equal points are one node, so the two halves of a
 *    street cut at a tile edge meet at the same node;
 * 2. the pieces of a street cut at a tile edge are joined into one way when exactly two ends of the
 *    same kind of way meet at a node;
 * 3. a dead end within `NODE_TOL_M` of another walkable way (not a bridge or a tunnel) is connected to
 *    it: to its nearest vertex when that is within half a metre of the meeting point, else the way is
 *    split at the meeting point.
 *
 * Pure: no DOM, no network.
 */

/** Grid of the snapped points, degrees (1e-6°, the same step as the compact codec). */
export const SNAP_STEP = 1e-6
/** A dead end this close to another walkable way is joined to it (a T-junction the tile simplified). */
export const NODE_TOL_M = 3
/** A meeting point this close to a vertex of the way it meets uses that vertex. */
const VERTEX_TOL_M = 0.5
/** Grid cell of the segment index, metres. */
const INDEX_CELL_M = 8

type Attr = Pick<OsmWay, 'kind' | 'highway' | 'tunnel' | 'bridge' | 'sub'>
type Line = { attr: Attr; pts: number[] }

const sameAttr = (a: Attr, b: Attr) => a.kind === b.kind && a.highway === b.highway && a.tunnel === b.tunnel && !!a.bridge === !!b.bridge && a.sub === b.sub

export type WalkNetStats = { ways: number; joined: number; connected: number; split: number }

/**
 * Build the walking network from decoded tiles. `bbox` is only what the result claims to cover
 * (and the centre of the projection). `stats`, when given, is filled in for tests and probes.
 */
export function buildWalkNet(tiles: readonly OsmData[], bbox: BBox, stats?: WalkNetStats): OsmData {
  const lat: number[] = []
  const lon: number[] = []
  const index = new Map<string, number>()
  const vertex = (la: number, lo: number): number => {
    const a = Math.round(la / SNAP_STEP)
    const b = Math.round(lo / SNAP_STEP)
    const key = `${a},${b}`
    let at = index.get(key)
    if (at === undefined) {
      at = lat.length
      index.set(key, at)
      lat.push(a * SNAP_STEP)
      lon.push(b * SNAP_STEP)
    }
    return at
  }

  // 1. Every walkable line of every tile, on snapped nodes.
  let lines: (Line | undefined)[] = []
  for (const t of tiles) {
    for (const w of t.ways) {
      if (!w.walkable || w.area || (w.kind !== 'road' && w.kind !== 'path') || w.nodes.length < 2) continue
      const pts: number[] = []
      for (const n of w.nodes) {
        const v = vertex(t.lat[n]!, t.lon[n]!)
        if (pts[pts.length - 1] !== v) pts.push(v)
      }
      if (pts.length < 2) continue
      lines.push({ attr: { kind: w.kind, highway: w.highway, tunnel: w.tunnel, ...(w.bridge ? { bridge: true } : {}), sub: w.sub }, pts })
    }
  }
  const total = lines.length

  // 2. Join the pieces of a street that a tile edge cut.
  const touches = (): number[] => {
    const count = new Array<number>(lat.length).fill(0)
    for (const l of lines) if (l) for (const v of l.pts) count[v]!++
    return count
  }
  let joined = 0
  const count = touches()
  const ends = new Map<number, number[]>()
  lines.forEach((l, k) => {
    if (!l) return
    for (const v of [l.pts[0]!, l.pts[l.pts.length - 1]!]) {
      if (count[v] !== 2) continue
      const list = ends.get(v)
      if (list) list.push(k)
      else ends.set(v, [k])
    }
  })
  for (const [v, list] of ends) {
    if (list.length !== 2) continue
    const [i, j] = list as [number, number]
    const a = lines[i]
    const b = lines[j]
    if (i === j || !a || !b || !sameAttr(a.attr, b.attr)) continue
    // Orient `a` so it ends at v and `b` so it starts there.
    const left = a.pts[a.pts.length - 1] === v ? a.pts : [...a.pts].reverse()
    const right = b.pts[0] === v ? b.pts : [...b.pts].reverse()
    if (left[left.length - 1] !== v || right[0] !== v) continue
    lines[i] = { attr: a.attr, pts: [...left, ...right.slice(1)] }
    lines[j] = undefined
    joined++
  }
  lines = lines.filter((l) => l !== undefined)

  // 3. Connect dead ends to a walkable way that passes within a few metres.
  const proj = new LocalProjection({ lat: (bbox.north + bbox.south) / 2, lon: (bbox.east + bbox.west) / 2 })
  const xy = lat.map((la, i) => proj.toXY({ lat: la, lon: lon[i]! }))
  const grid = new Map<string, [number, number][]>()
  const cellOf = (x: number, y: number) => `${Math.floor(x / INDEX_CELL_M)},${Math.floor(y / INDEX_CELL_M)}`
  lines.forEach((l, k) => {
    if (l!.attr.tunnel || l!.attr.bridge) return
    for (let s = 0; s + 1 < l!.pts.length; s++) {
      const a = xy[l!.pts[s]!]!
      const b = xy[l!.pts[s + 1]!]!
      const x0 = Math.floor((Math.min(a.x, b.x) - NODE_TOL_M) / INDEX_CELL_M)
      const x1 = Math.floor((Math.max(a.x, b.x) + NODE_TOL_M) / INDEX_CELL_M)
      const y0 = Math.floor((Math.min(a.y, b.y) - NODE_TOL_M) / INDEX_CELL_M)
      const y1 = Math.floor((Math.max(a.y, b.y) + NODE_TOL_M) / INDEX_CELL_M)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`
          const list = grid.get(key)
          if (list) list.push([k, s])
          else grid.set(key, [[k, s]])
        }
      }
    }
  })
  type Cut = { t: number; v: number }
  const cuts = new Map<string, Cut[]>()
  let connected = 0
  let split = 0
  lines.forEach((line, k) => {
    for (const end of [0, line!.pts.length - 1]) {
      const v = line!.pts[end]!
      if (count[v] !== 1) continue
      const p = xy[v]!
      let best: { d: number; line: number; seg: number; t: number } | undefined
      for (const [other, s] of grid.get(cellOf(p.x, p.y)) ?? []) {
        if (other === k) continue
        const a = xy[lines[other]!.pts[s]!]!
        const b = xy[lines[other]!.pts[s + 1]!]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
        if (d <= NODE_TOL_M && (!best || d < best.d)) best = { d, line: other, seg: s, t }
      }
      if (!best) continue
      const target = lines[best.line]!
      const a = target.pts[best.seg]!
      const b = target.pts[best.seg + 1]!
      const segLen = Math.hypot(xy[b]!.x - xy[a]!.x, xy[b]!.y - xy[a]!.y)
      let to: number
      if (best.t * segLen <= VERTEX_TOL_M) to = a
      else if ((1 - best.t) * segLen <= VERTEX_TOL_M) to = b
      else {
        to = vertex(lat[a]! + (lat[b]! - lat[a]!) * best.t, lon[a]! + (lon[b]! - lon[a]!) * best.t)
        if (to >= xy.length) xy[to] = proj.toXY({ lat: lat[to]!, lon: lon[to]! })
        const key = `${best.line}:${best.seg}`
        const list = cuts.get(key)
        if (list) list.push({ t: best.t, v: to })
        else cuts.set(key, [{ t: best.t, v: to }])
        split++
      }
      line!.pts[end] = to
      connected++
    }
  })
  // Insert the new vertices into the ways they cut: from the last segment back, so earlier indices hold.
  const byLine = new Map<number, [number, Cut[]][]>()
  for (const [key, list] of cuts) {
    const [lineAt, segAt] = key.split(':').map(Number) as [number, number]
    const mine = byLine.get(lineAt)
    if (mine) mine.push([segAt, list])
    else byLine.set(lineAt, [[segAt, list]])
  }
  for (const [lineAt, segs] of byLine) {
    segs.sort((p, q) => q[0] - p[0])
    for (const [segAt, list] of segs) {
      list.sort((p, q) => p.t - q.t)
      lines[lineAt]!.pts.splice(segAt + 1, 0, ...list.map((c) => c.v))
    }
  }

  // 4. Result: compact node tables, one way per line.
  const remap = new Map<number, number>()
  const outLat: number[] = []
  const outLon: number[] = []
  const keep = (v: number): number => {
    let at = remap.get(v)
    if (at === undefined) {
      at = outLat.length
      remap.set(v, at)
      outLat.push(lat[v]!)
      outLon.push(lon[v]!)
    }
    return at
  }
  const ways: OsmWay[] = []
  for (const l of lines) {
    const nodes: number[] = []
    for (const v of l!.pts) {
      const n = keep(v)
      if (nodes[nodes.length - 1] !== n) nodes.push(n)
    }
    if (nodes.length < 2) continue
    ways.push({ id: ways.length + 1, kind: l!.attr.kind, highway: l!.attr.highway, walkable: true, area: false, tunnel: l!.attr.tunnel, ...(l!.attr.bridge ? { bridge: true } : {}), crossing: false, ...(l!.attr.sub ? { sub: l!.attr.sub } : {}), nodes })
  }
  if (stats) Object.assign(stats, { ways: total, joined, connected, split })
  return { bbox, lat: Float64Array.from(outLat), lon: Float64Array.from(outLon), ways, pois: [], industrial: [], activity: [], source: 'tiles', timestamp: '' }
}
