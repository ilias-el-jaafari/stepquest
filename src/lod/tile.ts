import { VectorTile, classifyRings } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { tileBBox, tileSizeM, type TileId } from '../vector/tileMath.ts'
import { Area, NO_FOOT, Street, streetClassOf, type StreetClass } from './classes.ts'

/** Tile units of a LOD tile: every coordinate is scaled to this extent whatever the source tile used. */
export const LOD_EXTENT = 4096
/** Simplification tolerances in metres (design: Full detail around the hero). */
export const STREET_TOLERANCE_M = 1.5
export const BUILDING_TOLERANCE_M = 3
export const AREA_TOLERANCE_M = 4
/** Footprints under this many square metres are dropped. */
export const MIN_BUILDING_M2 = 12
/** Longest street name kept. */
const MAX_NAME = 40

/** Many shapes in three flat arrays: shape `i` is the points `xy[2 * start[i] .. 2 * start[i + 1])`, of kind `kind[i]`. */
export type LodGeom = { kind: Uint8Array; start: Uint32Array; xy: Int16Array }
export type LodNames = LodGeom & { text: string[] }

/** One z14 tile reduced to what the far zooms draw (requirement 25). Plain typed arrays: they are cloned into IndexedDB and moved from the worker. */
export type LodTile = {
  v: 1
  id: TileId
  /** Lines of `transportation` (class and `NO_FOOT` flag in `kind`). */
  streets: LodGeom
  /** Lines of `transportation_name` with their text (class in `kind`). */
  names: LodNames
  /** Polygons (`Area` in `kind`): one outer ring each. */
  areas: LodGeom
  waterways: LodGeom
}

class Builder {
  private readonly kinds: number[] = []
  private readonly starts: number[] = [0]
  private readonly xy: number[] = []
  readonly text: string[] = []

  get count(): number {
    return this.kinds.length
  }

  push(kind: number, pts: readonly (readonly [number, number])[], text?: string): void {
    this.kinds.push(kind)
    for (const [x, y] of pts) this.xy.push(clamp16(x), clamp16(y))
    this.starts.push(this.xy.length / 2)
    if (text !== undefined) this.text.push(text)
  }

  done(): LodGeom {
    return { kind: Uint8Array.from(this.kinds), start: Uint32Array.from(this.starts), xy: Int16Array.from(this.xy) }
  }
}

const clamp16 = (n: number): number => Math.max(-32768, Math.min(32767, Math.round(n)))
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

type Pt = readonly [number, number]

/** Douglas-Peucker on an open polyline; `tol` in the units of the points. Keeps both ends. */
export function simplify(pts: readonly Pt[], tol: number): Pt[] {
  const n = pts.length
  if (n <= 2 || tol <= 0) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  const t2 = tol * tol
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]!
    const [bx, by] = pts[b]!
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let far = -1
    let best = t2
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!
      let d2: number
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
      }
      if (d2 > best) {
        best = d2
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]!)
  return out
}

/** Area of a ring in square units (absolute). */
export function ringArea(ring: readonly Pt[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1]
  return Math.abs(s) / 2
}

/** A closed ring simplified; the closing point is dropped. Fewer than 3 points left: undefined. */
function simplifyRing(ring: readonly Pt[], tol: number): Pt[] | undefined {
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring.slice()
  if (open.length < 3) return undefined
  // Split at the farthest point from the first so Douglas-Peucker sees two open halves, not one degenerate loop.
  let far = 0
  let best = -1
  for (let i = 1; i < open.length; i++) {
    const d = (open[i]![0] - open[0]![0]) ** 2 + (open[i]![1] - open[0]![1]) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  const a = simplify(open.slice(0, far + 1), tol)
  const b = simplify([...open.slice(far), open[0]!], tol)
  const out = [...a, ...b.slice(1, -1)]
  return out.length >= 3 ? out : undefined
}

const AREA_LAYERS: Record<string, (p: Record<string, unknown>) => number | undefined> = {
  landcover: (p) => (['grass', 'wood', 'farmland', 'wetland'].includes(String(p.class)) ? Area.green : undefined),
  park: () => Area.green,
  landuse: (p) => (['pitch', 'playground', 'cemetery', 'park', 'garden'].includes(String(p.class)) ? Area.green : undefined),
  water: (p) => (p.class === 'swimming_pool' || p.brunnel === 'tunnel' ? undefined : Area.water),
  building: () => Area.building,
}

/**
 * Decode one MVT into a LOD tile (requirement 25.2). Pure and quick enough for the worker: streets by class, street names,
 * simplified building footprints, parks and water. Geometry stays in tile units (scaled to `LOD_EXTENT`), unclipped, so a
 * street cut at a seam is drawn by both tiles and the bitmaps meet exactly.
 */
export function tileToLod(bytes: Uint8Array, id: TileId): LodTile {
  const b = tileBBox(id)
  const mPerUnit = tileSizeM(id.z, (b.north + b.south) / 2) / LOD_EXTENT
  const streets = new Builder()
  const names = new Builder()
  const areas = new Builder()
  const waterways = new Builder()
  if (bytes.length) {
    const vt = new VectorTile(new PbfReader(bytes))
    for (const [name, layer] of Object.entries(vt.layers)) {
      const k = LOD_EXTENT / layer.extent
      const scale = (pts: readonly { x: number; y: number }[]): Pt[] => pts.map((q) => [q.x * k, q.y * k] as const)
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const p = f.properties as Record<string, unknown>
        if (name === 'transportation' || name === 'transportation_name') {
          if (f.type !== 2 || p.brunnel === 'tunnel') continue
          const cls = streetClassOf(str(p.class), str(p.subclass))
          if (cls === undefined) continue
          const label = name === 'transportation_name' ? (str(p.name) ?? str(p['name:latin'])) : undefined
          if (name === 'transportation_name' && !label) continue
          const kind = name === 'transportation' ? cls | (noFoot(cls, p) ? NO_FOOT : 0) : cls
          for (const line of f.loadGeometry()) {
            const pts = simplify(scale(line), STREET_TOLERANCE_M / mPerUnit)
            if (pts.length < 2) continue
            if (name === 'transportation') streets.push(kind, pts)
            else if (cls !== Street.rail && cls !== Street.busway) names.push(kind, pts, label!.slice(0, MAX_NAME))
          }
        } else if (name === 'waterway') {
          if (f.type !== 2 || p.brunnel === 'tunnel') continue
          for (const line of f.loadGeometry()) {
            const pts = simplify(scale(line), AREA_TOLERANCE_M / mPerUnit)
            if (pts.length >= 2) waterways.push(0, pts)
          }
        } else {
          const kindOf = AREA_LAYERS[name]
          if (!kindOf || f.type !== 3) continue
          const kind = kindOf(p)
          if (kind === undefined) continue
          const isBuilding = kind === Area.building
          const tol = (isBuilding ? BUILDING_TOLERANCE_M : AREA_TOLERANCE_M) / mPerUnit
          for (const poly of classifyRings(f.loadGeometry())) {
            const outer = poly[0]
            if (!outer) continue
            const ring = simplifyRing(scale(outer), tol)
            if (!ring) continue
            if (isBuilding && ringArea(ring) * mPerUnit * mPerUnit < MIN_BUILDING_M2) continue
            areas.push(kind, ring)
          }
        }
      }
    }
  }
  return { v: 1, id, streets: streets.done(), names: { ...names.done(), text: names.text }, areas: areas.done(), waterways: waterways.done() }
}

/** A street a pedestrian may not use: motorway, trunk, busway, `foot=no`, private or closed access without `foot=yes`. */
function noFoot(cls: StreetClass, p: Record<string, unknown>): boolean {
  if (cls === Street.motorway || cls === Street.trunk || cls === Street.busway || cls === Street.rail) return true
  if (p.foot === 'no') return true
  if (p.foot === 'yes' || p.foot === 'designated') return false
  return p.access === 'no' || p.access === 'private'
}

/** How many shapes a geometry holds. */
export const shapeCount = (g: LodGeom): number => g.kind.length

/** Points of shape `i`, as a view into `xy`: [from, to) in `xy` indices. */
export const shapeRange = (g: LodGeom, i: number): [number, number] => [g.start[i]! * 2, g.start[i + 1]! * 2]

/** Memory (and about the IndexedDB) size of a tile in bytes. */
export function lodBytes(t: LodTile): number {
  const g = (x: LodGeom) => x.kind.byteLength + x.start.byteLength + x.xy.byteLength
  return g(t.streets) + g(t.names) + g(t.areas) + g(t.waterways) + t.names.text.reduce((s, x) => s + x.length * 2, 0)
}

const isGeom = (g: unknown): g is LodGeom => !!g && typeof g === 'object' && (g as LodGeom).kind instanceof Uint8Array && (g as LodGeom).start instanceof Uint32Array && (g as LodGeom).xy instanceof Int16Array && (g as LodGeom).start.length === (g as LodGeom).kind.length + 1 && (g as LodGeom).xy.length === (g as LodGeom).start[(g as LodGeom).kind.length]! * 2

/** Whether a value read back from storage is a LOD tile of this version (a damaged one counts as a miss). */
export function isLodTile(x: unknown): x is LodTile {
  const t = x as LodTile | undefined
  return !!t && t.v === 1 && !!t.id && isGeom(t.streets) && isGeom(t.names) && Array.isArray(t.names.text) && t.names.text.length === t.names.kind.length && isGeom(t.areas) && isGeom(t.waterways)
}

/** An empty tile (open sea, no data). */
export const emptyLod = (id: TileId): LodTile => tileToLod(new Uint8Array(0), id)
