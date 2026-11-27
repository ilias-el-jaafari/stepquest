import type { BBox } from '../geo/geo.ts'
import { dedupePois } from '../osm/landmarks.ts'
import type { OsmData, OsmWay, Poi } from '../osm/types.ts'
import { dedupeSights } from '../sights/classify.ts'
import type { Ground, Sight } from '../sights/types.ts'
import { cellKey, cellOf } from './cells.ts'
import { boxArea, unionBox } from './coverage.ts'
import type { CellRecord } from './slice.ts'

const LINE_KINDS = new Set<OsmWay['kind']>(['road', 'path', 'waterway', 'barrier', 'rail'])
const isLine = (w: OsmWay) => LINE_KINDS.has(w.kind) && !w.area

/** `small` is a contiguous run of `big`, read in either direction. */
export function isRunOf(small: readonly number[], big: readonly number[]): boolean {
  if (small.length > big.length) return false
  const n = small.length
  for (const dir of [1, -1]) {
    for (let at = 0; at + n <= big.length; at++) {
      let ok = true
      for (let k = 0; k < n && ok; k++) ok = big[at + k] === small[dir === 1 ? k : n - 1 - k]
      if (ok) return true
    }
  }
  return false
}

const closed = (nodes: readonly number[]) => nodes.length > 2 && nodes[0] === nodes[nodes.length - 1]

/** Join two runs that meet at an end point; undefined when they do not. */
export function joinRuns(a: readonly number[], b: readonly number[]): number[] | undefined {
  const a0 = a[0]!
  const a1 = a[a.length - 1]!
  const b0 = b[0]!
  const b1 = b[b.length - 1]!
  if (a1 === b0) return [...a, ...b.slice(1)]
  if (a1 === b1) return [...a, ...[...b].reverse().slice(1)]
  if (a0 === b1) return [...b, ...a.slice(1)]
  if (a0 === b0) return [...[...b].reverse(), ...a.slice(1)]
  return undefined
}

/**
 * The merged map of every loaded cell, grown by adding cell records. Append-only: a node or way keeps
 * its index for as long as the object lives, so graph edges and route nodes stay valid when cells
 * arrive. A way that is replaced by a fuller version (the same street seen whole in the next cell, or
 * two halves joined) is *retired*: it keeps its slot and is skipped by `liveWays()`.
 *
 * Rules, per OSM way id (and kind): a run of nodes that is part of an existing run is dropped; an
 * existing run that is part of the new one is retired; a line that meets an existing run at an end
 * point is joined with it; area ways are only deduplicated. Nodes at the same coordinates are one node
 * (whatever record they come from), which makes the result independent of the order of arrival.
 */
export class WorldData {
  readonly lat: number[] = []
  readonly lon: number[] = []
  readonly ways: OsmWay[] = []
  readonly retired = new Set<number>()
  /** Indices of the ways that came from vector-tile walking records (they carry no tags until enriched). */
  readonly tileWays = new Set<number>()
  pois: Poi[] = []
  sights: Sight[] = []
  grounds: Ground[] = []
  private readonly seenGrounds = new Set<string>()
  industrial: number[][] = []
  activity: number[] = []
  /** Coverage per cell key (the larger one when a cell was seen partly first). */
  readonly coverage = new Map<string, BBox>()
  source: OsmData['source'] = 'fixture'
  timestamp = ''
  private readonly coordIndex = new Map<string, number>()
  private readonly byId = new Map<string, number[]>()
  private readonly seenActivity = new Set<string>()
  private readonly seenIndustrial = new Set<string>()

  /** Add sights (drawn records carry them, walking records do not); true when the list changed. */
  addSights(list: readonly Sight[] | undefined): boolean {
    if (!list?.length) return false
    const merged = dedupeSights([...this.sights, ...list])
    const changed = merged.length !== this.sights.length || merged.some((s, i) => s !== this.sights[i])
    if (changed) this.sights = merged
    return changed
  }

  /** Add areas of sights (one copy of each piece, whichever cells carried it); true when the list grew. */
  addGrounds(list: readonly Ground[] | undefined): boolean {
    let grew = false
    for (const g of list ?? []) {
      const key = `${g.kind}:${g.mode}:${g.ring.length}:${g.ring[0]},${g.ring[1]}:${g.ring[g.ring.length - 2]},${g.ring[g.ring.length - 1]}`
      if (this.seenGrounds.has(key)) continue
      this.seenGrounds.add(key)
      this.grounds.push(g)
      grew = true
    }
    return grew
  }

  /** Add one record; returns the index of the first way it appended (the graph reads from there). */
  addRecord(rec: CellRecord): { firstWay: number } {
    const { data } = rec
    const firstWay = this.ways.length
    const local = new Map<number, number>()
    const node = (n: number): number => {
      let at = local.get(n)
      if (at === undefined) {
        const la = data.lat[n]!
        const lo = data.lon[n]!
        const key = `${la},${lo}`
        at = this.coordIndex.get(key)
        if (at === undefined) {
          at = this.lat.length
          this.lat.push(la)
          this.lon.push(lo)
          this.coordIndex.set(key, at)
        }
        local.set(n, at)
      }
      return at
    }
    for (const way of data.ways) {
      const nodes: number[] = []
      for (const n of way.nodes) {
        const m = node(n)
        if (nodes[nodes.length - 1] !== m) nodes.push(m)
      }
      if (nodes.length < 2) continue
      const at = this.place({ ...way, nodes, ...(way.holes ? { holes: way.holes.map((h) => h.map(node)) } : {}) })
      if (at >= 0 && data.source === 'tiles') this.tileWays.add(at)
    }
    for (const ring of data.industrial ?? []) {
      const mapped = ring.map(node)
      const sig = mapped.join(',')
      if (this.seenIndustrial.has(sig)) continue
      this.seenIndustrial.add(sig)
      this.industrial.push(mapped)
    }
    const act = data.activity ?? []
    for (let i = 0; i + 1 < act.length; i += 2) {
      const key = `${act[i]},${act[i + 1]}`
      if (this.seenActivity.has(key)) continue
      this.seenActivity.add(key)
      this.activity.push(act[i]!, act[i + 1]!)
    }
    if (data.pois.length) this.pois = dedupePois([...this.pois, ...data.pois])
    if (data.sights?.length) this.sights = dedupeSights([...this.sights, ...data.sights])
    this.addGrounds(data.grounds)
    const key = cellKey(rec.cell)
    const had = this.coverage.get(key)
    if (!had || boxArea(rec.coverage) > boxArea(had)) this.coverage.set(key, rec.coverage)
    if (data.source === 'overpass') this.source = 'overpass'
    else if (data.source === 'tiles' && this.source !== 'overpass') this.source = 'tiles'
    if (data.timestamp > this.timestamp) this.timestamp = data.timestamp
    return { firstWay }
  }

  private contains(big: OsmWay, small: OsmWay): boolean {
    if (isLine(big) && isLine(small)) return isRunOf(small.nodes, big.nodes)
    if (big.area !== small.area) return false
    const set = new Set(big.nodes)
    return small.nodes.every((n) => set.has(n)) && (big.holes?.length ?? 0) === (small.holes?.length ?? 0)
  }

  private retire(key: string, index: number): void {
    this.retired.add(index)
    const list = this.byId.get(key)
    if (list) list.splice(list.indexOf(index), 1)
  }

  /** Put a way in; returns its index, or -1 when it was already there (a piece of an existing run). */
  private place(way: OsmWay): number {
    const key = `${way.kind}:${way.id}`
    let cur = way
    let list = this.byId.get(key)
    if (!list) this.byId.set(key, (list = []))
    for (;;) {
      if (list.some((k) => this.contains(this.ways[k]!, cur))) return -1
      for (const k of [...list]) if (this.contains(cur, this.ways[k]!)) this.retire(key, k)
      if (!isLine(cur) || closed(cur.nodes)) break
      let joined: { k: number; nodes: number[] } | undefined
      for (const k of list) {
        const e = this.ways[k]!
        if (!isLine(e) || closed(e.nodes)) continue
        const nodes = joinRuns(e.nodes, cur.nodes)
        if (nodes) {
          joined = { k, nodes }
          break
        }
      }
      if (!joined) break
      this.retire(key, joined.k)
      cur = { ...this.ways[joined.k]!, nodes: joined.nodes }
    }
    list.push(this.ways.length)
    this.ways.push(cur)
    return this.ways.length - 1
  }

  /** Replace a way by a copy with other tags (earlier snapshots keep the old object). Returns whether anything changed. */
  retag(index: number, tags: { safety?: number; name?: string }): boolean {
    const way = this.ways[index]
    if (!way || ((tags.safety ?? way.safety) === way.safety && (tags.name ?? way.name) === way.name)) return false
    this.ways[index] = { ...way, ...(tags.safety !== undefined ? { safety: tags.safety } : {}), ...(tags.name !== undefined ? { name: tags.name } : {}) }
    return true
  }

  /** The ways that count: everything except the retired slots. */
  liveWays(): OsmWay[] {
    return this.ways.filter((_, k) => !this.retired.has(k))
  }

  /**
   * An immutable `OsmData` (copied arrays; way objects are shared and never changed). A retired way
   * keeps its slot (so indices hold) with no nodes, so nothing draws or routes it twice; its tags stay
   * readable for edges that were built from it before it was retired.
   */
  snapshot(): OsmData {
    const coverage = [...this.coverage.values()]
    const ways = this.retired.size ? this.ways.map((w, k) => (this.retired.has(k) ? { ...w, nodes: [], holes: undefined } : w)) : this.ways.slice()
    return {
      bbox: coverage.length ? unionBox(coverage) : { south: 0, west: 0, north: 0, east: 0 },
      lat: Float64Array.from(this.lat),
      lon: Float64Array.from(this.lon),
      ways,
      pois: this.pois.slice(),
      ...(this.sights.length ? { sights: this.sights.slice() } : {}),
      ...(this.grounds.length ? { grounds: this.grounds.slice() } : {}),
      industrial: this.industrial.slice(),
      activity: this.activity.slice(),
      coverage,
      source: this.source,
      timestamp: this.timestamp,
    }
  }
}

/** Merge records into a fresh `WorldData` in a fixed order (by cell), whatever order they come in. */
export function compact(records: readonly CellRecord[]): WorldData {
  const wd = new WorldData()
  for (const r of [...records].sort((a, b) => a.cell.i - b.cell.i || a.cell.j - b.cell.j)) wd.addRecord(r)
  return wd
}

/** The cell a record belongs to, from its coverage (for tests and checks). */
export const cellOfRecord = (r: CellRecord) => cellOf({ lat: (r.coverage.south + r.coverage.north) / 2, lon: (r.coverage.west + r.coverage.east) / 2 })
