import type { BBox } from '../geo/geo.ts'
import { FEATURE_KINDS, type OsmData, type OsmWay } from './types.ts'

/**
 * Compact JSON form used for the bundled demo fixture and the offline cache:
 * coordinates are delta-encoded integers (1e-6 degrees ≈ 0.1 m), and each way
 * is a flat array `[kind, highwayIndex, flags, ...deltaNodeIndices]`.
 */
export type CompactOsm = {
  v: 1
  bbox: [number, number, number, number]
  timestamp: string
  source: OsmData['source']
  highways: string[]
  dlat: number[]
  dlon: number[]
  ways: number[][]
  ids: number[]
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
  for (const way of data.ways) {
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
    const row = [FEATURE_KINDS.indexOf(way.kind), hw, flags]
    let prev = 0
    for (const n of way.nodes) {
      row.push(n - prev)
      prev = n
    }
    ways.push(row)
    ids.push(way.id)
  }
  const { south, west, north, east } = data.bbox
  return { v: 1, bbox: [south, west, north, east], timestamp: data.timestamp, source: data.source, highways, dlat, dlon, ways, ids }
}

export function decodeOsm(compact: CompactOsm): OsmData {
  if (compact.v !== 1) throw new Error(`Unsupported map data version ${String(compact.v)}`)
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
  const ways: OsmWay[] = compact.ways.map((row, i) => {
    const kind = FEATURE_KINDS[row[0] ?? 0] ?? 'road'
    const hw = row[1] ?? -1
    const flags = row[2] ?? 0
    const nodes: number[] = []
    let prev = 0
    for (let j = 3; j < row.length; j++) {
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
      nodes,
    }
  })
  const [south, west, north, east] = compact.bbox
  const bbox: BBox = { south, west, north, east }
  return { bbox, lat, lon, ways, source: compact.source, timestamp: compact.timestamp }
}
