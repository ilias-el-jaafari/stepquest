import { encodeMvt, type FixtureFeature, type FixtureLayer } from '../vector/testing.ts'
import type { TileId } from '../vector/tileMath.ts'
import { tileToLod, type LodTile } from './tile.ts'

/** Test helpers: a LOD tile from hand-made features (tile units, extent 4096), without the network. */
export type MadeLine = { cls: string; sub?: string; pts: [number, number][]; props?: Record<string, string | number> }
export type MadeName = { name: string; cls: string; pts: [number, number][] }
export type MadeArea = { layer: 'building' | 'park' | 'water' | 'landcover'; cls?: string; ring: [number, number][] }

export function makeMvt(o: { lines?: MadeLine[]; names?: MadeName[]; areas?: MadeArea[] }): Uint8Array {
  const layers: FixtureLayer[] = []
  const line = (l: MadeLine): FixtureFeature => ({ type: 2, props: { class: l.cls, ...(l.sub ? { subclass: l.sub } : {}), ...(l.props ?? {}) }, geometry: [l.pts] })
  if (o.lines?.length) layers.push({ name: 'transportation', features: o.lines.map(line) })
  if (o.names?.length) layers.push({ name: 'transportation_name', features: o.names.map((n) => ({ type: 2, props: { class: n.cls, name: n.name }, geometry: [n.pts] })) })
  for (const layer of ['building', 'park', 'water', 'landcover'] as const) {
    const a = (o.areas ?? []).filter((x) => x.layer === layer)
    if (a.length) layers.push({ name: layer, features: a.map((x) => ({ type: 3, props: x.cls ? { class: x.cls } : ({} as Record<string, string | number>), geometry: [[...x.ring, x.ring[0]!]] })) })
  }
  return encodeMvt(layers)
}

export function makeLod(id: TileId, o: Parameters<typeof makeMvt>[0] = {}): LodTile {
  return tileToLod(makeMvt(o), id)
}

/** A square ring of `size` units with its corner at (x, y). */
export const square = (x: number, y: number, size: number): [number, number][] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]

/** A 2D context that records what is drawn (the software canvas of the golden tests has no paths). */
export type Call = { op: string; args: unknown[] }
export function recordingCtx() {
  const calls: Call[] = []
  const state: Record<string, unknown> = {}
  const widths: number[] = []
  const target = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === 'calls') return calls
        if (prop === 'widths') return widths
        if (prop in state) return state[prop]
        return (...args: unknown[]) => {
          calls.push({ op: prop, args })
        }
      },
      set(_, prop: string, value) {
        state[prop] = value
        if (prop === 'lineWidth') widths.push(value as number)
        if (prop === 'fillStyle' || prop === 'strokeStyle') calls.push({ op: `set:${prop}`, args: [value] })
        return true
      },
    },
  )
  return target as unknown as CanvasRenderingContext2D & { calls: Call[]; widths: number[] }
}

/** A fake canvas for the store: a size and a recording context. */
export function fakeCanvasFactory() {
  const made: { size: number; ctx: ReturnType<typeof recordingCtx> }[] = []
  const make = (size: number) => {
    const ctx = recordingCtx()
    made.push({ size, ctx })
    const canvas = { width: size, height: size } as unknown as HTMLCanvasElement
    return { canvas, ctx }
  }
  return { make, made }
}
