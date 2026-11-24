import type { BBox } from '../geo/geo.ts'
import type { OsmData, OsmWay, Poi } from '../osm/types.ts'
import { cellBBox, type CellId } from './cells.ts'
import type { CellRecord } from './slice.ts'

/** Test helpers: tiny hand-made cell records. */
export type SketchWay = { id: number; pts: [number, number][]; kind?: OsmWay['kind']; highway?: string; area?: boolean }

export function makeData(ways: SketchWay[], bbox: BBox, extra: { pois?: Poi[]; activity?: number[]; source?: OsmData['source'] } = {}): OsmData {
  const lat: number[] = []
  const lon: number[] = []
  const at = new Map<string, number>()
  const out: OsmWay[] = ways.map((w) => ({
    id: w.id,
    kind: w.kind ?? 'road',
    highway: w.highway ?? 'residential',
    walkable: (w.kind ?? 'road') === 'road' || w.kind === 'path',
    area: w.area ?? false,
    tunnel: false,
    crossing: false,
    nodes: w.pts.map(([la, lo]) => {
      const k = `${la},${lo}`
      let i = at.get(k)
      if (i === undefined) {
        i = lat.length
        at.set(k, i)
        lat.push(la)
        lon.push(lo)
      }
      return i
    }),
  }))
  return { bbox, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways: out, pois: extra.pois ?? [], activity: extra.activity ?? [], industrial: [], source: extra.source ?? 'overpass', timestamp: '' }
}

export function makeRecord(cell: CellId, ways: SketchWay[], extra: Parameters<typeof makeData>[2] = {}, coverage: BBox = cellBBox(cell)): CellRecord {
  return { cell, coverage, savedAt: 0, data: makeData(ways, coverage, extra) }
}

/** Ways as coordinate lists, direction-normalised and sorted: a canonical form to compare maps. */
export function liveShapes(data: { lat: ArrayLike<number>; lon: ArrayLike<number>; ways: OsmWay[] }, live: (k: number) => boolean = () => true): string[] {
  const out: string[] = []
  data.ways.forEach((w, k) => {
    if (!live(k)) return
    const pts = w.nodes.map((n) => `${data.lat[n]},${data.lon[n]}`)
    const rev = [...pts].reverse()
    out.push(`${w.kind}:${w.id}:${(pts.join(';') < rev.join(';') ? pts : rev).join(';')}`)
  })
  return out.sort()
}
