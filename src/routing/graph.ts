import { haversine, LocalProjection, type BBox, type LatLon } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import { crossesIsland, findRoundabouts } from '../osm/roundabout.ts'
import { makeInside } from '../world/coverage.ts'
import { MinHeap } from './heap.ts'
import { plazaChords } from './plazaChords.ts'


/** A size of a growing graph (see `GraphAccumulator.mark`). */
export type GraphMark = { nodes: number; edges: number; bbox: BBox }

type PendingEdge = { a: number; b: number; way: number; checkIsland: boolean }

/**
 * The growing edge list of a walking graph. `add(data, fromWay)` takes the ways from `fromWay` on
 * (all of them for a single extract) and appends their edges; an edge whose end lies outside the
 * loaded area is remembered and added when a later `add` has the area covered (cells arriving). Node
 * ids (first appearance) and edge ids never change once issued, so a route built on an earlier graph
 * stays valid. Inside means inside `data.coverage` (the loaded cells), else inside `data.bbox`.
 */
export class GraphAccumulator {
  /** Data node index to graph node id. */
  readonly map = new Map<number, number>()
  readonly pairs: [number, number][] = []
  readonly pairWay: number[] = []
  readonly pairLength: number[] = []
  bbox: BBox = { south: 0, west: 0, north: 0, east: 0 }
  /** Ways before this index have been taken. */
  processed = 0
  /** Coordinates per graph node id. */
  readonly lats: number[] = []
  readonly lons: number[] = []
  private readonly seen = new Set<string>()
  private pending: PendingEdge[] = []
  private pendingRings: number[] = []

  get nodeCount(): number {
    return this.lats.length
  }

  /** How far the graph has grown (a `WalkGraph` built later with this limit is the graph of now). */
  mark(): GraphMark {
    return { nodes: this.lats.length, edges: this.pairs.length, bbox: this.bbox }
  }

  add(data: OsmData, fromWay = this.processed): this {
    this.bbox = data.bbox
    const inside0 = makeInside(data)
    const inside = (n: number) => inside0(data.lat[n] ?? 0, data.lon[n] ?? 0)
    // Roundabout islands are never walked across: an edge that runs through
    // one (a path mapped over the island, a chord between two ring nodes) is dropped.
    const islands = findRoundabouts(data)
    const ringWays = new Set(islands.flatMap((r) => r.ways))
    const { south, west, north, east } = data.bbox
    const islandProjection = new LocalProjection({ lat: (south + north) / 2, lon: (east + west) / 2 })
    const xyOf = (n: number) => islandProjection.toXY({ lat: data.lat[n] ?? 0, lon: data.lon[n] ?? 0 })
    const addEdge = (a: number, b: number, wayIndex: number, checkIsland: boolean) => {
      if (a === b) return
      // Only route inside the loaded area: ways that leave it are clipped, so the walk
      // always stays on the part of the map we actually draw.
      if (!inside(a) || !inside(b)) {
        this.pending.push({ a, b, way: wayIndex, checkIsland })
        return
      }
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (this.seen.has(key)) return
      if (checkIsland && islands.length && crossesIsland(xyOf(a), xyOf(b), islands)) return
      this.seen.add(key)
      for (const n of [a, b]) {
        if (!this.map.has(n)) {
          this.map.set(n, this.map.size)
          this.lats.push(data.lat[n] ?? 0)
          this.lons.push(data.lon[n] ?? 0)
        }
      }
      const ga = this.map.get(a)!
      const gb = this.map.get(b)!
      this.pairs.push([ga, gb])
      this.pairWay.push(wayIndex)
      this.pairLength.push(haversine({ lat: this.lats[ga]!, lon: this.lons[ga]! }, { lat: this.lats[gb]!, lon: this.lons[gb]! }))
    }
    const retry = this.pending
    this.pending = []
    for (let wayIndex = fromWay; wayIndex < data.ways.length; wayIndex++) {
      const way = data.ways[wayIndex]!
      if (!way.walkable) continue
      for (let i = 1; i < way.nodes.length; i++) addEdge(way.nodes[i - 1]!, way.nodes[i]!, wayIndex, !ringWays.has(wayIndex))
    }
    // Edges that were outside the area at an earlier `add`: the area may have grown over them.
    for (const p of retry) addEdge(p.a, p.b, p.way, p.checkIsland)
    // A pedestrian plaza (a closed footway/pedestrian area) is open ground: add walkable
    // chords across it, after the ring edges so a ring edge always wins a duplicate.
    const rings = this.pendingRings
    this.pendingRings = []
    const plaza = (wayIndex: number) => {
      const way = data.ways[wayIndex]!
      if (!way.walkable || !way.area || way.kind !== 'path' || way.nodes.length < 5 || way.nodes[0] !== way.nodes[way.nodes.length - 1]) return
      const ring = way.nodes.slice(0, -1)
      if (!ring.every(inside)) {
        // Clipped by the loaded area: the outline is not the real shape (yet).
        this.pendingRings.push(wayIndex)
        return
      }
      for (const [i, j] of plazaChords(ring.map(xyOf))) addEdge(ring[i]!, ring[j]!, wayIndex, true)
    }
    for (const w of rings) plaza(w)
    for (let wayIndex = fromWay; wayIndex < data.ways.length; wayIndex++) plaza(wayIndex)
    this.processed = data.ways.length
    return this
  }
}

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
  // A* working memory, reused by every search (one allocation per graph, not per leg).
  // An entry is valid only when its stamp equals the current search's generation.
  private readonly gScore: Float64Array
  private readonly prevNode: Int32Array
  private readonly prevEdge: Int32Array
  private readonly seenStamp: Uint32Array
  private readonly closedStamp: Uint32Array
  private readonly heap = new MinHeap()
  private generation = 0

  /**
   * Build from one extract, or from an accumulator that has been fed cell by cell
   * (`new WalkGraph(data)` is exactly `GraphAccumulator.add(data)` plus the build below).
   */
  constructor(source: OsmData | GraphAccumulator, upTo?: GraphMark) {
    const acc = source instanceof GraphAccumulator ? source : new GraphAccumulator().add(source)
    // The accumulator only appends, so its first `upTo` nodes and edges are exactly the graph at that time.
    const nodeCount = upTo?.nodes ?? acc.nodeCount
    const edgeCount = upTo?.edges ?? acc.pairs.length
    const pairs = edgeCount === acc.pairs.length ? acc.pairs : acc.pairs.slice(0, edgeCount)
    const pairLength = acc.pairLength
    const data = { bbox: upTo?.bbox ?? acc.bbox }
    this.size = nodeCount
    this.lat = Float64Array.from(acc.lats.slice(0, nodeCount))
    this.lon = Float64Array.from(acc.lons.slice(0, nodeCount))
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
    this.edgeWay = Int32Array.from(acc.pairWay.slice(0, edgeCount))
    pairs.forEach(([a, b], e) => {
      const len = pairLength[e]!
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
    this.gScore = new Float64Array(this.size)
    this.prevNode = new Int32Array(this.size)
    this.prevEdge = new Int32Array(this.size)
    this.seenStamp = new Uint32Array(this.size)
    this.closedStamp = new Uint32Array(this.size)
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
    // New search: bump the generation instead of clearing the arrays.
    if (++this.generation === 0xffffffff) {
      this.seenStamp.fill(0)
      this.closedStamp.fill(0)
      this.generation = 1
    }
    const gen = this.generation
    const { gScore, prevNode, prevEdge, seenStamp, closedStamp, heap, x, y } = this
    heap.clear()
    const tx = x[to]!
    const ty = y[to]!
    const hScale = 0.995 * Math.min(1, minPenalty)
    const h = (n: number) => {
      const dx = x[n]! - tx
      const dy = y[n]! - ty
      return Math.sqrt(dx * dx + dy * dy) * hScale
    }
    gScore[from] = 0
    prevNode[from] = -1
    prevEdge[from] = -1
    seenStamp[from] = gen
    heap.push(h(from), from)
    while (heap.size) {
      const n = heap.pop()!
      if (closedStamp[n] === gen) continue
      closedStamp[n] = gen
      if (n === to) break
      const gn = gScore[n]!
      for (let i = this.offsets[n]!; i < this.offsets[n + 1]!; i++) {
        const m = this.targets[i]!
        if (closedStamp[m] === gen) continue
        const e = this.edgeIds[i]!
        const cost = this.lengths[i]! * (penalty ? penalty[e]! : 1)
        if (cost === Infinity) continue
        const gm = gn + cost
        if (seenStamp[m] !== gen || gm < gScore[m]!) {
          seenStamp[m] = gen
          gScore[m] = gm
          prevNode[m] = n
          prevEdge[m] = e
          heap.push(gm + h(m), m)
        }
      }
    }
    if (closedStamp[to] !== gen) return undefined
    const nodes: number[] = []
    const edges: number[] = []
    let length = 0
    for (let n = to; n !== -1; n = prevNode[n]!) {
      nodes.push(n)
      if (prevEdge[n]! >= 0) edges.push(prevEdge[n]!)
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
