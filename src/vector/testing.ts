import { PbfWriter } from 'pbf'
import type { OsmData } from '../osm/types.ts'
import { tileBBox, tileXY, type TileId } from './tileMath.ts'

/**
 * Test helpers: a tiny Mapbox Vector Tile encoder (spec 2.1), so tests build their own tiles and
 * never touch the network, and an empty tile for streamer tests.
 */
export type FixtureFeature = { type: 1 | 2 | 3; props?: Record<string, string | number>; geometry: [number, number][][]; id?: number }
export type FixtureLayer = { name: string; extent?: number; features: FixtureFeature[] }

const zigzag = (n: number) => (n << 1) ^ (n >> 31)
const command = (id: number, count: number) => (id & 7) | (count << 3)

function geometryOf(f: FixtureFeature): number[] {
  const out: number[] = []
  let cx = 0
  let cy = 0
  const moveTo = (x: number, y: number) => {
    out.push(zigzag(x - cx), zigzag(y - cy))
    cx = x
    cy = y
  }
  for (const ring of f.geometry) {
    let pts = ring
    if (f.type === 3 && pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts = pts.slice(0, -1)
    if (f.type === 1) {
      out.push(command(1, pts.length))
      for (const [x, y] of pts) moveTo(x, y)
      continue
    }
    out.push(command(1, 1))
    moveTo(pts[0]![0], pts[0]![1])
    out.push(command(2, pts.length - 1))
    for (const [x, y] of pts.slice(1)) moveTo(x, y)
    if (f.type === 3) out.push(command(7, 1))
  }
  return out
}

/** Encode layers as one MVT. Property values are strings or integers. */
export function encodeMvt(layers: readonly FixtureLayer[]): Uint8Array {
  const pbf = new PbfWriter()
  for (const layer of layers) {
    pbf.writeMessage(
      3,
      (l: FixtureLayer, w: PbfWriter) => {
        w.writeVarintField(15, 2)
        w.writeStringField(1, l.name)
        const keys: string[] = []
        const values: (string | number)[] = []
        const index = <T,>(list: T[], v: T) => {
          let i = list.indexOf(v)
          if (i < 0) i = list.push(v) - 1
          return i
        }
        const tagged = l.features.map((f) => ({ f, tags: Object.entries(f.props ?? {}).flatMap(([k, v]) => [index(keys, k), index(values, v)]) }))
        for (const { f, tags } of tagged) {
          w.writeMessage(
            2,
            (_: unknown, fw: PbfWriter) => {
              if (f.id !== undefined) fw.writeVarintField(1, f.id)
              fw.writePackedVarint(2, tags)
              fw.writeVarintField(3, f.type)
              fw.writePackedVarint(4, geometryOf(f))
            },
            null,
          )
        }
        for (const k of keys) w.writeStringField(3, k)
        for (const v of values) {
          w.writeMessage(
            4,
            (_: unknown, vw: PbfWriter) => {
              if (typeof v === 'string') vw.writeStringField(1, v)
              else vw.writeSVarintField(6, v)
            },
            null,
          )
        }
        w.writeVarintField(5, l.extent ?? 4096)
      },
      layer,
    )
  }
  return pbf.finish()
}

/** Integer tile coordinates (extent 4096) of a point in tile `t`; may lie outside 0..4096 (the buffer). */
export function px(t: TileId, lat: number, lon: number, extent = 4096): [number, number] {
  const p = tileXY(lat, lon, t.z)
  return [Math.round((p.x - t.x) * extent), Math.round((p.y - t.y) * extent)]
}

export function emptyTile(t: TileId): OsmData {
  return { bbox: tileBBox(t), lat: new Float64Array(0), lon: new Float64Array(0), ways: [], pois: [], industrial: [], activity: [], source: 'tiles', timestamp: '' }
}
