import { haversine, LocalProjection, type LatLon } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import { MinHeap } from './heap.ts'

/**
 * Undirected pedestrian graph in compressed sparse row form. Nodes are the OSM
 * nodes of walkable ways; edges are the segments between consecutive nodes.
 */
export class WalkGraph {
  readonly size: number
  readonly lat: Float64Array
  readonly lon: Float64Array
  /** CSR offsets: neighbours of n are in [offsets[n], offsets[n+1]). */
  readonly offsets: Uint32Array
  readonly targets: Uint32Array
  readonly lengths: Float64Array
  /** Undirected edge id for each half-edge (shared by both directions). */
  readonly edgeIds: Uint32Array
  readonly edgeCount: number
  /** Index into OsmData.ways of the way each undirected edge belongs to. */
  readonly edgeWay: Int32Array
  /** Connected component label per node; component 0 is the largest. */
  readonly component: Int32Array
  private readonly projection: LocalProjection
  private readonly x: Float64Array
  private readonly y: Float64Array

  constructor(data: OsmData) {
    const map = new Map<number, number>()
    const pairs: [number, number][] = []
    const pairWay: number[] = []
    const seen = new Set<string>()
    // Only route inside the loaded box: ways that leave it are clipped, so the
    // walk always stays on the part of the map we actually draw.
    const { south, west, north, east } = data.bbox
    const inside = (n: number) => {
      const la = data.lat[n] ?? 0
      const lo = data.lon[n] ?? 0
      return la >= south && la <= north && lo >= west && lo <= east
    }
    data.ways.forEach((way, wayIndex) => {
      if (!way.walkable) return
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i - 1]!
        const b = way.nodes[i]!
        if (a === b || !inside(a) || !inside(b)) continue
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (seen.has(key)) continue
        seen.add(key)
        for (const n of [a, b]) if (!map.has(n)) map.set(n, map.size)
        pairs.push([map.get(a)!, map.get(b)!])
        pairWay.push(wayIndex)
      }
    })
    this.size = map.size
    this.lat = new Float64Array(this.size)
    this.lon = new Float64Array(this.size)
    for (const [osm, id] of map) {
      this.lat[id] = data.lat[osm] ?? 0
      this.lon[id] = data.lon[osm] ?? 0
    }
    const degree = new Uint32Array(this.size + 1)
    for (const [a, b] of pairs) {
      degree[a]!++
      degree[b]!++
    }
    this.offsets = new Uint32Array(this.size + 1)
    for (let i = 0; i < this.size; i++) this.offsets[i + 1] = this.offsets[i]! + degree[i]!
    const fill = this.offsets.slice(0, this.size)
    this.targets = new Uint32Array(pairs.length * 2)
    this.lengths = new Float64Array(pairs.length * 2)
    this.edgeIds = new Uint32Array(pairs.length * 2)
    this.edgeCount = pairs.length
    this.edgeWay = Int32Array.from(pairWay)
    pairs.forEach(([a, b], e) => {
      const len = haversine(this.point(a), this.point(b))
      const ia = fill[a]!++
      this.targets[ia] = b
      this.lengths[ia] = len
      this.edgeIds[ia] = e
      const ib = fill[b]!++
      this.targets[ib] = a
      this.lengths[ib] = len
      this.edgeIds[ib] = e
    })
    this.projection = new LocalProjection({ lat: (data.bbox.north + data.bbox.south) / 2, lon: (data.bbox.east + data.bbox.west) / 2 })
    this.x = new Float64Array(this.size)
    this.y = new Float64Array(this.size)
    for (let i = 0; i < this.size; i++) {
      const p = this.projection.toXY(this.point(i))
      this.x[i] = p.x
      this.y[i] = p.y
    }
    this.component = this.labelComponents()
  }

  point(n: number): LatLon {
    return { lat: this.lat[n] ?? 0, lon: this.lon[n] ?? 0 }
  }

  private labelComponents(): Int32Array {
    const label = new Int32Array(this.size).fill(-1)
    const sizes: number[] = []
    const stack: number[] = []
    for (let s = 0; s < this.size; s++) {
      if (label[s] !== -1) continue
      const c = sizes.length
      let count = 0
      label[s] = c
      stack.push(s)
      while (stack.length) {
        const n = stack.pop()!
        count++
        for (let i = this.offsets[n]!; i < this.offsets[n + 1]!; i++) {
          const m = this.targets[i]!
          if (label[m] === -1) {
            label[m] = c
            stack.push(m)
          }
        }
      }
      sizes.push(count)
    }
    // Renumber so the largest component is 0.
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]! - sizes[a]!)
    const rank = new Int32Array(sizes.length)
    order.forEach((c, r) => (rank[c] = r))
    for (let i = 0; i < this.size; i++) label[i] = rank[label[i]!]!
    return label
  }

  /** Nearest node in the main connected network (brute force; ~50k nodes is fast enough). */
  nearestNode(p: LatLon, mainOnly = true): { node: number; distance: number } | undefined {
    const { x, y } = this.projection.toXY(p)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.size; i++) {
      if (mainOnly && this.component[i] !== 0) continue
      const dx = this.x[i]! - x
      const dy = this.y[i]! - y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best < 0 ? undefined : { node: best, distance: Math.sqrt(bestD) }
  }

  /**
   * A* shortest path. `penalty[edgeId]` multiplies an edge's cost (≥ 1), which
   * steers later legs of a loop away from streets already used. An infinite
   * penalty closes the edge. `minPenalty` is the smallest value in `penalty`
   * (below 1 when some streets are preferred), which keeps A* exact.
   */
  shortestPath(from: number, to: number, penalty?: Float32Array, minPenalty = 1): { nodes: number[]; edges: number[]; length: number } | undefined {
    if (from === to) return { nodes: [from], edges: [], length: 0 }
    const g = new Float64Array(this.size).fill(Infinity)
    const prev = new Int32Array(this.size).fill(-1)
    const prevEdge = new Int32Array(this.size).fill(-1)
    const closed = new Uint8Array(this.size)
    const heap = new MinHeap()
    const tx = this.x[to]!
    const ty = this.y[to]!
    const hScale = 0.995 * Math.min(1, minPenalty)
    const h = (n: number) => Math.hypot(this.x[n]! - tx, this.y[n]! - ty) * hScale
    g[from] = 0
    heap.push(h(from), from)
    while (heap.size) {
      const n = heap.pop()!
      if (closed[n]) continue
      closed[n] = 1
      if (n === to) break
      const gn = g[n]!
      for (let i = this.offsets[n]!; i < this.offsets[n + 1]!; i++) {
        const m = this.targets[i]!
        if (closed[m]) continue
        const e = this.edgeIds[i]!
        const cost = this.lengths[i]! * (penalty ? penalty[e]! : 1)
        if (cost === Infinity) continue
        const gm = gn + cost
        if (gm < g[m]!) {
          g[m] = gm
          prev[m] = n
          prevEdge[m] = e
          heap.push(gm + h(m), m)
        }
      }
    }
    if (prev[to] === -1) return undefined
    const nodes: number[] = []
    const edges: number[] = []
    let length = 0
    for (let n = to; n !== -1; n = prev[n]!) {
      nodes.push(n)
      if (prevEdge[n]! >= 0) {
        edges.push(prevEdge[n]!)
      }
    }
    nodes.reverse()
    edges.reverse()
    for (let i = 1; i < nodes.length; i++) length += this.edgeLength(nodes[i - 1]!, nodes[i]!)
    return { nodes, edges, length }
  }

  edgeLength(a: number, b: number): number {
    for (let i = this.offsets[a]!; i < this.offsets[a + 1]!; i++) if (this.targets[i] === b) return this.lengths[i]!
    return haversine(this.point(a), this.point(b))
  }
}
