import type { BBox } from '../geo/geo.ts'
import { MONUMENT_CLASSES, SIGHT_KINDS, type Ground, type Sight } from '../sights/types.ts'
import { FEATURE_KINDS, LANDMARK_KINDS, type OsmData, type OsmWay, type Poi } from './types.ts'

/**
 * Compact JSON form used for the bundled demo fixture and the offline cache:
 * coordinates are delta-encoded integers (1e-6 degrees ≈ 0.1 m), and each way
 * is a flat array `[kind, highwayIndex, flags, styleIndex, ...deltaNodeIndices]`
 * (version 1 had no style index). Landmarks are `[kind, lat1e6, lon1e6]` triples.
 * Version 6 adds the areas of sights (`gr`: rows `[kind, mode (0 grounds, 1 footprint), length, lat1e6, lon1e6, ...]`). Version 5 adds sights (`sg`, `sgn`). Version 3 adds street names and safety flags per way (`wn`, `ws`), industrial
 * land rings (`ind`, node indices) and lively places (`act`, lat/lon 1e6 pairs).
 * Version 4 adds the bridge flag and multipolygon holes (`holes`: per way index,
 * delta-encoded node rings). Decoding accepts versions 1 to 5 and rejects
 * anything inconsistent with a {@link CorruptDataError}; encoding always writes
 * {@link CODEC_VERSION}.
 */
export type CompactOsm = {
  v: 1 | 2 | 3 | 4 | 5 | 6
  bbox: [number, number, number, number]
  timestamp: string
  source: OsmData['source']
  highways: string[]
  dlat: number[]
  dlon: number[]
  ways: number[][]
  ids: number[]
  subs?: string[]
  pois?: number[]
  names?: string[]
  /** Per way: index into `names`, or -1. */
  wn?: number[]
  /** Per way: safety flags. */
  ws?: number[]
  /** Version 5: sights, rows of `[kind, lat1e6, lon1e6, rank + 1 (0 = none), name index + 1 (0 = none), monument class + 1 (0 = none), flags]`; names in `sgn`. */
  sg?: number[]
  sgn?: string[]
  gr?: number[]
  ind?: number[][]
  act?: number[]
  /** Version 4: inner rings, `w` is the index into `ways`, `r` the delta-encoded node rings. */
  holes?: { w: number; r: number[][] }[]
}

/** Version written by {@link encodeOsm}. The area cache keys include it, so a change here retires old entries. */
export const CODEC_VERSION = 6

/** Thrown by {@link decodeOsm} for data that is not a map extract this code wrote (damaged cache, other version). */
export class CorruptDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorruptDataError'
  }
}

const SCALE = 1e6
const FLAG_WALKABLE = 1
const FLAG_AREA = 2
const FLAG_TUNNEL = 4
const FLAG_CROSSING = 8
const FLAG_ROUNDABOUT = 16
const FLAG_BRIDGE = 32

function deltaRing(ring: readonly number[]): number[] {
  let prev = 0
  return ring.map((n) => {
    const d = n - prev
    prev = n
    return d
  })
}

function undeltaRing(deltas: readonly number[]): number[] {
  let prev = 0
  return deltas.map((d) => (prev += d))
}

/**
 * A compact extract as the JSON text the download worker sends and the caches keep. A string moves between
 * threads and into IndexedDB as one flat copy, where the same extract as nested arrays costs tens of ms
 * of structured cloning on the main thread. Entries written as objects (older caches) still decode.
 */
export type StoredOsm = CompactOsm | string

/** The object form of a stored extract; text that is not JSON is {@link CorruptDataError}. */
export function parseCompact(stored: StoredOsm): CompactOsm {
  if (typeof stored !== 'string') return stored
  try {
    return JSON.parse(stored) as CompactOsm
  } catch {
    throw new CorruptDataError('Stored map data is not valid JSON')
  }
}

export function encodeOsm(data: OsmData): CompactOsm {
  const dlat: number[] = []
  const dlon: number[] = []
  let prevLat = 0
  let prevLon = 0
  for (let i = 0; i < data.lat.length; i++) {
    const la = Math.round((data.lat[i] ?? 0) * SCALE)
    const lo = Math.round((data.lon[i] ?? 0) * SCALE)
    dlat.push(la - prevLat)
    dlon.push(lo - prevLon)
    prevLat = la
    prevLon = lo
  }
  const highways: string[] = []
  const hwIndex = new Map<string, number>()
  const ways: number[][] = []
  const ids: number[] = []
  const subs: string[] = []
  const subIndex = new Map<string, number>()
  const names: string[] = []
  const nameIndex = new Map<string, number>()
  const wn: number[] = []
  const ws: number[] = []
  const holes: { w: number; r: number[][] }[] = []
  for (const way of data.ways) {
    let nm = -1
    if (way.name) {
      nm = nameIndex.get(way.name) ?? -1
      if (nm < 0) {
        nm = names.length
        names.push(way.name)
        nameIndex.set(way.name, nm)
      }
    }
    wn.push(nm)
    ws.push(way.safety ?? 0)
    let sub = -1
    if (way.sub) {
      sub = subIndex.get(way.sub) ?? -1
      if (sub < 0) {
        sub = subs.length
        subs.push(way.sub)
        subIndex.set(way.sub, sub)
      }
    }
    let hw = -1
    if (way.highway) {
      hw = hwIndex.get(way.highway) ?? -1
      if (hw < 0) {
        hw = highways.length
        highways.push(way.highway)
        hwIndex.set(way.highway, hw)
      }
    }
    const flags = (way.walkable ? FLAG_WALKABLE : 0) | (way.area ? FLAG_AREA : 0) | (way.tunnel ? FLAG_TUNNEL : 0) | (way.crossing ? FLAG_CROSSING : 0) | (way.roundabout ? FLAG_ROUNDABOUT : 0) | (way.bridge ? FLAG_BRIDGE : 0)
    const row = [FEATURE_KINDS.indexOf(way.kind), hw, flags, sub]
    let prev = 0
    for (const n of way.nodes) {
      row.push(n - prev)
      prev = n
    }
    ways.push(row)
    ids.push(way.id)
    if (way.holes?.length) holes.push({ w: ways.length - 1, r: way.holes.map(deltaRing) })
  }
  const { south, west, north, east } = data.bbox
  const pois: number[] = []
  for (const p of data.pois) pois.push(LANDMARK_KINDS.indexOf(p.kind), Math.round(p.lat * SCALE), Math.round(p.lon * SCALE))
  const sg: number[] = []
  const sgn: string[] = []
  const sgIndex = new Map<string, number>()
  for (const s of data.sights ?? []) {
    let nm = 0
    if (s.name) {
      let at = sgIndex.get(s.name)
      if (at === undefined) {
        at = sgn.length
        sgn.push(s.name)
        sgIndex.set(s.name, at)
      }
      nm = at + 1
    }
    const mc = s.monument ? MONUMENT_CLASSES.indexOf(s.monument) + 1 : 0
    sg.push(SIGHT_KINDS.indexOf(s.kind), Math.round(s.lat * SCALE), Math.round(s.lon * SCALE), s.rank === undefined ? 0 : Math.max(0, Math.round(s.rank)) + 1, nm, mc, (s.wikidata ? 1 : 0) | (s.wikipedia ? 2 : 0))
  }
  const gr: number[] = []
  for (const g of data.grounds ?? []) {
    gr.push(SIGHT_KINDS.indexOf(g.kind), g.mode === 'footprint' ? 1 : 0, g.ring.length / 2)
    for (const v of g.ring) gr.push(Math.round(v * SCALE))
  }
  const act = (data.activity ?? []).map((v) => Math.round(v * SCALE))
  return { v: CODEC_VERSION, bbox: [south, west, north, east], timestamp: data.timestamp, source: data.source, highways, dlat, dlon, ways, ids, subs, pois, names, wn, ws, ind: data.industrial ?? [], act, ...(sg.length ? { sg, sgn } : {}), ...(gr.length ? { gr } : {}), ...(holes.length ? { holes } : {}) }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Check the shape of untrusted data (IndexedDB can hold anything after a crash or an older release). */
function validate(c: CompactOsm): void {
  const bad = (what: string): never => {
    throw new CorruptDataError(`Corrupt map data: ${what}`)
  }
  if (!c || typeof c !== 'object') bad('not an object')
  if (c.v !== 1 && c.v !== 2 && c.v !== 3 && c.v !== 4 && c.v !== 5 && c.v !== 6) throw new CorruptDataError(`Unsupported map data version ${String(c.v)}`)
  if (!Array.isArray(c.bbox) || c.bbox.length !== 4 || !c.bbox.every(isNum)) bad('bbox')
  if (!Array.isArray(c.dlat) || !Array.isArray(c.dlon) || c.dlat.length !== c.dlon.length) bad('coordinates')
  if (!c.dlat.every(isNum) || !c.dlon.every(isNum)) bad('coordinates')
  if (!Array.isArray(c.ways) || !Array.isArray(c.ids) || !Array.isArray(c.highways)) bad('ways')
  if (c.ids.length < c.ways.length) bad('way ids')
  const n = c.dlat.length
  const first = c.v === 1 ? 3 : 4
  const inRange = (prev: number) => Number.isInteger(prev) && prev >= 0 && prev < n
  for (const row of c.ways) {
    if (!Array.isArray(row) || row.length < first || !row.every(isNum)) bad('way row')
    if (!Number.isInteger(row[0]) || (row[0] ?? -1) < 0 || (row[0] ?? 0) >= FEATURE_KINDS.length) bad('way kind')
    let prev = 0
    for (let j = first; j < row.length; j++) {
      prev += row[j] ?? 0
      if (!inRange(prev)) bad('node index')
    }
  }
  for (const ring of [...(c.ind ?? []), ...(c.holes ?? []).flatMap((h) => h.r)]) {
    if (!Array.isArray(ring)) bad('ring')
  }
  for (const h of c.holes ?? []) {
    if (!h || !Number.isInteger(h.w) || h.w < 0 || h.w >= c.ways.length || !Array.isArray(h.r)) bad('hole')
    for (const r of h.r) {
      let prev = 0
      for (const d of r) {
        prev += d
        if (!inRange(prev)) bad('hole node index')
      }
    }
  }
  for (const ring of c.ind ?? []) if (!ring.every((i) => inRange(i))) bad('industrial ring')
}

export function decodeOsm(stored: CompactOsm | string): OsmData {
  const compact = parseCompact(stored)
  validate(compact)
  const n = compact.dlat.length
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  let la = 0
  let lo = 0
  for (let i = 0; i < n; i++) {
    la += compact.dlat[i] ?? 0
    lo += compact.dlon[i] ?? 0
    lat[i] = la / SCALE
    lon[i] = lo / SCALE
  }
  const first = compact.v === 1 ? 3 : 4
  const ways: OsmWay[] = compact.ways.map((row, i) => {
    const kind = FEATURE_KINDS[row[0] ?? 0] ?? 'road'
    const hw = row[1] ?? -1
    const flags = row[2] ?? 0
    const nodes: number[] = []
    let prev = 0
    for (let j = first; j < row.length; j++) {
      prev += row[j] ?? 0
      nodes.push(prev)
    }
    return {
      id: compact.ids[i] ?? 0,
      kind,
      highway: hw >= 0 ? compact.highways[hw] : undefined,
      walkable: (flags & FLAG_WALKABLE) !== 0,
      area: (flags & FLAG_AREA) !== 0,
      tunnel: (flags & FLAG_TUNNEL) !== 0,
      crossing: (flags & FLAG_CROSSING) !== 0,
      ...((flags & FLAG_BRIDGE) !== 0 ? { bridge: true } : {}),
      ...((flags & FLAG_ROUNDABOUT) !== 0 ? { roundabout: true } : {}),
      sub: compact.v === 1 ? undefined : compact.subs?.[row[3] ?? -1],
      nodes,
      ...(compact.names && (compact.wn?.[i] ?? -1) >= 0 ? { name: compact.names[compact.wn![i]!] } : {}),
      ...(compact.ws && (flags & FLAG_WALKABLE) !== 0 ? { safety: compact.ws[i] ?? 0 } : {}),
    }
  })
  for (const h of compact.holes ?? []) ways[h.w]!.holes = h.r.map(undeltaRing)
  const pois: Poi[] = []
  const raw = compact.pois ?? []
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const kind = LANDMARK_KINDS[raw[i] ?? -1]
    if (kind && isNum(raw[i + 1]) && isNum(raw[i + 2])) pois.push({ kind, lat: (raw[i + 1] ?? 0) / SCALE, lon: (raw[i + 2] ?? 0) / SCALE })
  }
  const sights: Sight[] = []
  const sg = compact.v >= 5 ? (compact.sg ?? []) : []
  for (let i = 0; i + 6 < sg.length; i += 7) {
    const kind = SIGHT_KINDS[sg[i] ?? -1]
    if (!kind || !isNum(sg[i + 1]) || !isNum(sg[i + 2])) continue
    const rank = sg[i + 3] ?? 0
    const nm = sg[i + 4] ?? 0
    const mc = MONUMENT_CLASSES[(sg[i + 5] ?? 0) - 1]
    const flags = sg[i + 6] ?? 0
    const name = nm > 0 ? compact.sgn?.[nm - 1] : undefined
    sights.push({ kind, lat: (sg[i + 1] ?? 0) / SCALE, lon: (sg[i + 2] ?? 0) / SCALE, ...(name ? { name } : {}), ...(rank > 0 ? { rank: rank - 1 } : {}), ...(mc ? { monument: mc } : {}), ...(flags & 1 ? { wikidata: true } : {}), ...(flags & 2 ? { wikipedia: true } : {}) })
  }
  const grounds: Ground[] = []
  const gr = compact.v >= 6 ? (compact.gr ?? []) : []
  for (let i = 0; i + 2 < gr.length; ) {
    const kind = SIGHT_KINDS[gr[i] ?? -1]
    const n = gr[i + 2] ?? 0
    if (!isNum(n) || n < 0 || i + 3 + 2 * n > gr.length) throw new CorruptDataError('grounds rows do not fit')
    if (kind && n >= 3) grounds.push({ kind, mode: gr[i + 1] === 1 ? 'footprint' : 'grounds', ring: gr.slice(i + 3, i + 3 + 2 * n).map((v) => v / SCALE) })
    i += 3 + 2 * n
  }
  const [south, west, north, east] = compact.bbox
  const bbox: BBox = { south, west, north, east }
  const extra = compact.v >= 3 ? { industrial: compact.ind ?? [], activity: (compact.act ?? []).map((v) => v / SCALE) } : {}
  return { bbox, lat, lon, ways, pois, ...(sights.length ? { sights } : {}), ...(grounds.length ? { grounds } : {}), ...extra, source: compact.source, timestamp: compact.timestamp }
}
