import type { BBox } from '../geo/geo.ts'
import { FEATURE_KINDS, LANDMARK_KINDS, type OsmData, type OsmWay, type Poi } from './types.ts'

/**
 * Compact JSON form used for the bundled demo fixture and the offline cache:
 * coordinates are delta-encoded integers (1e-6 degrees ≈ 0.1 m), and each way
 * is a flat array `[kind, highwayIndex, flags, styleIndex, ...deltaNodeIndices]`
 * (version 1 had no style index). Landmarks are `[kind, lat1e6, lon1e6]` triples.
 * Version 3 adds street names and safety flags per way (`wn`, `ws`), industrial
 * land rings (`ind`, node indices) and lively places (`act`, lat/lon 1e6 pairs).
 * Version 4 adds the bridge flag and multipolygon holes (`holes`: per way index,
 * delta-encoded node rings). Decoding accepts versions 1 to 4 and rejects
 * anything inconsistent with a {@link CorruptDataError}; encoding always writes
 * {@link CODEC_VERSION}.
 */
export type CompactOsm = {
  v: 1 | 2 | 3 | 4
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
  ind?: number[][]
  act?: number[]
  /** Version 4: inner rings, `w` is the index into `ways`, `r` the delta-encoded node rings. */
  holes?: { w: number; r: number[][] }[]
}

/** Version written by {@link encodeOsm}. The area cache keys include it, so a change here retires old entries. */
export const CODEC_VERSION = 4

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
  const act = (data.activity ?? []).map((v) => Math.round(v * SCALE))
  return { v: CODEC_VERSION, bbox: [south, west, north, east], timestamp: data.timestamp, source: data.source, highways, dlat, dlon, ways, ids, subs, pois, names, wn, ws, ind: data.industrial ?? [], act, ...(holes.length ? { holes } : {}) }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Check the shape of untrusted data (IndexedDB can hold anything after a crash or an older release). */
function validate(c: CompactOsm): void {
  const bad = (what: string): never => {
    throw new CorruptDataError(`Corrupt map data: ${what}`)
  }
  if (!c || typeof c !== 'object') bad('not an object')
  if (c.v !== 1 && c.v !== 2 && c.v !== 3 && c.v !== 4) throw new CorruptDataError(`Unsupported map data version ${String(c.v)}`)
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

export function decodeOsm(compact: CompactOsm): OsmData {
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
  const [south, west, north, east] = compact.bbox
  const bbox: BBox = { south, west, north, east }
  const extra = compact.v >= 3 ? { industrial: compact.ind ?? [], activity: (compact.act ?? []).map((v) => v / SCALE) } : {}
  return { bbox, lat, lon, ways, pois, ...extra, source: compact.source, timestamp: compact.timestamp }
}
