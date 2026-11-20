import type { BBox } from '../geo/geo.ts'
import { FEATURE_KINDS, LANDMARK_KINDS, type OsmData, type OsmWay, type Poi } from './types.ts'

/**
 * Compact JSON form used for the bundled demo fixture and the offline cache:
 * coordinates are delta-encoded integers (1e-6 degrees ≈ 0.1 m), and each way
 * is a flat array `[kind, highwayIndex, flags, styleIndex, ...deltaNodeIndices]`
 * (version 1 had no style index). Landmarks are `[kind, lat1e6, lon1e6]` triples.
 */
export type CompactOsm = {
  v: 1 | 2
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
}

const SCALE = 1e6
const FLAG_WALKABLE = 1
const FLAG_AREA = 2
const FLAG_TUNNEL = 4
const FLAG_CROSSING = 8

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
  for (const way of data.ways) {
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
    const flags = (way.walkable ? FLAG_WALKABLE : 0) | (way.area ? FLAG_AREA : 0) | (way.tunnel ? FLAG_TUNNEL : 0) | (way.crossing ? FLAG_CROSSING : 0)
    const row = [FEATURE_KINDS.indexOf(way.kind), hw, flags, sub]
    let prev = 0
    for (const n of way.nodes) {
      row.push(n - prev)
      prev = n
    }
    ways.push(row)
    ids.push(way.id)
  }
  const { south, west, north, east } = data.bbox
  const pois: number[] = []
  for (const p of data.pois) pois.push(LANDMARK_KINDS.indexOf(p.kind), Math.round(p.lat * SCALE), Math.round(p.lon * SCALE))
  return { v: 2, bbox: [south, west, north, east], timestamp: data.timestamp, source: data.source, highways, dlat, dlon, ways, ids, subs, pois }
}

export function decodeOsm(compact: CompactOsm): OsmData {
  if (compact.v !== 1 && compact.v !== 2) throw new Error(`Unsupported map data version ${String(compact.v)}`)
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
      sub: compact.v === 1 ? undefined : compact.subs?.[row[3] ?? -1],
      nodes,
    }
  })
  const pois: Poi[] = []
  const raw = compact.pois ?? []
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const kind = LANDMARK_KINDS[raw[i] ?? -1]
    if (kind) pois.push({ kind, lat: (raw[i + 1] ?? 0) / SCALE, lon: (raw[i + 2] ?? 0) / SCALE })
  }
  const [south, west, north, east] = compact.bbox
  const bbox: BBox = { south, west, north, east }
  return { bbox, lat, lon, ways, pois, source: compact.source, timestamp: compact.timestamp }
}
