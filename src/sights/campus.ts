import { Terrain, type TileGrid } from '../tiles/grid.ts'
import type { House } from '../town/types.ts'
import type { SightKind, SightMark } from './types.ts'

/**
 * A sight at the size of its real area (landmarks spec, requirement L10). `buildCampus` turns the rings of a
 * mark (campus grounds or a building footprint) into a map of roles over the tile grid: special roof and
 * façade tiles where the buildings are, campus lawn, paving and trees on the rest of the grounds, and nothing
 * on streets, paths, crossings and water. An ordinary house whose lot lies mostly inside is replaced whole.
 * Pure: no DOM, a function of the grid, the houses and the mark.
 */

export const Role = { none: 0, lawn: 1, paving: 2, tree: 3, roof: 4, wall: 5, court: 6, steps: 7 } as const
export type RoleId = (typeof Role)[keyof typeof Role]

export const isBuildingRole = (r: number): boolean => r === Role.roof || r === Role.wall
/** Roles whose tiles are map building tiles of the area: the decor stays off them. */
export const isBlockedRole = (r: number): boolean => r === Role.roof || r === Role.wall || r === Role.court

/** Per tile features (task 93): what a façade, roof or entrance tile carries on top of its role. */
export const Feat = {
  none: 0,
  door: 1,
  portico: 2,
  balcony: 3,
  pediment: 4,
  rose: 5,
  canopyN: 6,
  canopyE: 7,
  canopyW: 8,
  stepsS: 9,
  stepsN: 10,
  stepsE: 11,
  stepsW: 12,
  slopeA: 13,
  slopeB: 14,
  ridge: 15,
  skylight: 16,
  planter: 17,
  gate: 18,
  bay: 19,
  fence: 20,
  courtPath: 21,
  /** The gate seen from the side (entrance faces east or west). */
  gateV: 22,
  fenceN: 23,
  fenceE: 24,
  fenceW: 25,
} as const

/** The entrance features each kind carries (L14.3), for tests and for the painter. */
export const ICONIC_FEATS: Partial<Record<SightKind, number[]>> = {
  university: [Feat.door, Feat.portico, Feat.pediment],
  townHall: [Feat.door, Feat.portico, Feat.balcony],
  church: [Feat.door, Feat.rose],
  temple: [Feat.door, Feat.gate],
  hospital: [Feat.door, Feat.bay],
  school: [Feat.door, Feat.fence],
  mosque: [Feat.door],
  synagogue: [Feat.door],
}

export type RoofKind = 'pitched' | 'flat' | 'terrace'
/** Variants per kind (roof kind and extras); the painter's `VARIANTS` has the same length. */
export const VARIANT_TRAITS: Record<SightKind, { roofKind: RoofKind; chimney?: boolean; cupola?: boolean }[]> = {
  university: [{ roofKind: 'pitched' }, { roofKind: 'pitched', chimney: true }, { roofKind: 'flat' }, { roofKind: 'pitched', chimney: true }, { roofKind: 'pitched', cupola: true }, { roofKind: 'terrace' }],
  school: [{ roofKind: 'pitched', chimney: true }, { roofKind: 'pitched' }, { roofKind: 'flat' }, { roofKind: 'terrace' }],
  hospital: [{ roofKind: 'flat' }, { roofKind: 'flat' }, { roofKind: 'pitched' }, { roofKind: 'terrace' }],
  church: [{ roofKind: 'pitched' }, { roofKind: 'pitched', chimney: true }, { roofKind: 'pitched', cupola: true }],
  mosque: [{ roofKind: 'flat' }, { roofKind: 'flat' }, { roofKind: 'flat' }],
  synagogue: [{ roofKind: 'pitched' }, { roofKind: 'pitched', chimney: true }, { roofKind: 'pitched' }],
  temple: [{ roofKind: 'pitched' }, { roofKind: 'pitched' }, { roofKind: 'pitched' }],
  townHall: [{ roofKind: 'pitched' }, { roofKind: 'pitched', cupola: true }, { roofKind: 'pitched', chimney: true }],
  tower: [{ roofKind: 'pitched' }],
  arch: [{ roofKind: 'pitched' }],
  statue: [{ roofKind: 'pitched' }],
  fountain: [{ roofKind: 'pitched' }],
}

/** Mean size of a house lot of the town layout (4–7 × 4–6 tiles): the unit of "at least three lots". */
export const LOT_TILES = 28
/** Smallest drawn footprint per kind (tiles); smaller polygons are grown around their centroid (L14.1). */
export const MIN_FOOTPRINT_TILES: Partial<Record<SightKind, number>> = { townHall: 3 * LOT_TILES, church: 30, mosque: 36, synagogue: 28, temple: 36, school: 30, hospital: 48 }
/** Two buildings whose boxes are this close (tiles) are neighbours: they get different variants. */
export const ADJ_GAP = 5
/** How far (tiles) the entrance search looks for a street from the middle of each side. */
export const STREET_SEARCH = 12

export type Side = 'N' | 'E' | 'S' | 'W'
export type Prop = { type: 'pole' | 'chimney' | 'cupola'; /** Foot position, tile units. */ x: number; y: number; seed: number }

/** A group of 8-connected building tiles: its tile box (x1, y1 inclusive), size, look and entrance. */
export type CampusBuilding = {
  x0: number
  y0: number
  x1: number
  y1: number
  tiles: number
  variant: number
  storeys: number
  court?: { x0: number; y0: number; x1: number; y1: number }
  /** The entrance: the building tile with the door, and the side it faces. */
  door?: { x: number; y: number; side: Side }
}

export type Campus = {
  kind: SightKind
  id: string
  mode: 'grounds' | 'footprint'
  /** Tile box of the roles map. */
  x0: number
  y0: number
  w: number
  h: number
  roles: Uint8Array
  /** Feature byte per tile (`Feat`). */
  feat: Uint8Array
  /** Building index per tile, or -1. */
  group: Int16Array
  /** Drop shadow per free tile: bit 1 east of a building, bit 2 south of one. */
  shade: Uint8Array
  props: Prop[]
  buildings: CampusBuilding[]
  /** The main building (index into `buildings`), if the area has any. */
  main?: number
  /** Where the crown of the main building stands: x is a tile column centre (tile units), y the bottom edge of its façade row. */
  crown?: { x: number; y: number }
}

/** Largest area (tiles per side) that is built; a bigger ring is a mapping accident and is left as plain map. */
export const MAX_SIDE = 400
/** Tiles of margin around the rings (the widest house lot). */
export const LOT_MARGIN = 7
/** Extra margin: plaza and steps (grounds), growth of a small footprint (footprints). */
const PLAZA_MARGIN = 4
const GROW_MARGIN = 12
/** A house lot is replaced whole when at least this share of its tiles lies inside the area. */
export const LOT_SHARE = 1 / 3
/** A building group must be at least this wide (tiles) and this big to carry a crown. */
export const CROWN_MIN_W = 3
export const CROWN_MIN_TILES = 8

const NO_KEEP: ReadonlySet<number> = new Set()
const SIDES: Record<Side, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }

const strHash = (str: string): number => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

const isStreet = (t: number | undefined): boolean => t === Terrain.road || t === Terrain.path || t === Terrain.crossing || t === Terrain.water || t === Terrain.plaza

/** Deterministic tile hash for the trees of the lawn. */
const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

/** Tile-unit rings (even-odd, tile centres) filled into `inside`, a `w × h` mask over the box at (x0, y0). */
function fillRings(rings: readonly { x: number; y: number }[][], x0: number, y0: number, w: number, h: number): Uint8Array {
  const inside = new Uint8Array(w * h)
  for (const ring of rings) {
    const n = ring.length
    for (let row = 0; row < h; row++) {
      const yc = y0 + row + 0.5
      const xs: number[] = []
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[j]!
        const b = ring[i]!
        if (a.y > yc !== b.y > yc) xs.push(a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k]! - 0.5 - x0))
        const to = Math.min(w - 1, Math.ceil(xs[k + 1]! - 0.5 - x0) - 1)
        for (let c = from; c <= to; c++) inside[row * w + c] = 1
      }
    }
  }
  return inside
}

/** 8-connected groups of building tiles of a roles map. */
function groupBuildings(roles: Uint8Array, w: number, h: number, x0: number, y0: number): { list: CampusBuilding[]; at: Int32Array } {
  const at = new Int32Array(w * h).fill(-1)
  const list: CampusBuilding[] = []
  const stack: number[] = []
  for (let s = 0; s < roles.length; s++) {
    if (!isBuildingRole(roles[s]!) || at[s]! >= 0) continue
    const id = list.length
    const b: CampusBuilding = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, tiles: 0, variant: 0, storeys: 1 }
    stack.push(s)
    at[s] = id
    while (stack.length) {
      const k = stack.pop()!
      const cx = k % w
      const cy = (k - cx) / w
      b.tiles++
      b.x0 = Math.min(b.x0, x0 + cx)
      b.x1 = Math.max(b.x1, x0 + cx)
      b.y0 = Math.min(b.y0, y0 + cy)
      b.y1 = Math.max(b.y1, y0 + cy)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const nk = ny * w + nx
          if (at[nk]! >= 0 || !isBuildingRole(roles[nk]!)) continue
          at[nk] = id
          stack.push(nk)
        }
      }
    }
    list.push(b)
  }
  return { list, at }
}

/**
 * The roles map of one mark, or undefined when it has no area, the area is off the loaded map, or it is
 * absurdly large. `houseAt` is the town's answer for a tile index (the renderer's `TownLookup`).
 */
export function buildCampus(grid: TileGrid, houseAt: (i: number) => House | undefined, mark: SightMark, keep: ReadonlySet<number> = NO_KEEP): Campus | undefined {
  const area = mark.area
  if (!area) return undefined
  const rings = area.rings.map((flat) => {
    const r: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < flat.length; i += 2) r.push(grid.toTileXY({ lat: flat[i]!, lon: flat[i + 1]! }))
    return r
  })
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rings) {
    for (const p of r) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return undefined
  const minTiles = area.mode === 'footprint' ? (MIN_FOOTPRINT_TILES[mark.kind] ?? 0) : 0
  // A margin of one lot, so a house lot that reaches out of the grounds is taken whole; more for growth and the plaza.
  const margin = LOT_MARGIN + (minTiles ? GROW_MARGIN : PLAZA_MARGIN)
  const x0 = Math.max(0, Math.floor(minX) - margin)
  const y0 = Math.max(0, Math.floor(minY) - margin)
  const x1 = Math.min(grid.cols - 1, Math.ceil(maxX) + margin)
  const y1 = Math.min(grid.rows - 1, Math.ceil(maxY) + margin)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return undefined
  const inside = fillRings(rings, x0, y0, w, h)
  const at = (gx: number, gy: number) => (gx - x0) + (gy - y0) * w
  const loaded = (gx: number, gy: number) => grid.coveredAt(gx, gy)
  const inBox = (gx: number, gy: number) => gx >= x0 && gy >= y0 && gx < x0 + w && gy < y0 + h

  // Only loaded ground that is not a street, path, crossing, water or plaza counts.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!inside[k]) continue
      const gx = x0 + x
      const gy = y0 + y
      if (!loaded(gx, gy) || isStreet(grid.terrain[grid.index(gx, gy)])) inside[k] = 0
    }
  }

  // Growth (L14.1): a small footprint becomes a rectangle around its centroid, on free tiles only.
  let grown = false
  if (minTiles > 0) {
    let n = 0
    let sx = 0
    let sy = 0
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    for (let k = 0; k < inside.length; k++) {
      if (!inside[k]) continue
      const gx = x0 + (k % w)
      const gy = y0 + Math.floor(k / w)
      n++
      sx += gx + 0.5
      sy += gy + 0.5
      bx0 = Math.min(bx0, gx)
      bx1 = Math.max(bx1, gx + 1)
      by0 = Math.min(by0, gy)
      by1 = Math.max(by1, gy + 1)
    }
    if (n < minTiles) {
      const cx = n ? sx / n : (minX + maxX) / 2
      const cy = n ? sy / n : (minY + maxY) / 2
      let hw = n ? (bx1 - bx0) / 2 : 1
      let hh = n ? (by1 - by0) / 2 : 1
      const rectOf = () => {
        let xa = Math.round(cx - hw)
        let xb = Math.round(cx + hw)
        if ((xb - xa) % 2 === 0) xb++
        const ya = Math.round(cy - hh)
        const yb = Math.round(cy + hh)
        return { xa, xb, ya, yb }
      }
      const canGrow = (gx: number, gy: number) => inBox(gx, gy) && loaded(gx, gy) && !isStreet(grid.terrain[grid.index(gx, gy)]) && !keep.has(grid.index(gx, gy))
      const total = (r: { xa: number; xb: number; ya: number; yb: number }) => {
        let t = 0
        for (let gy = Math.max(y0, r.ya); gy < Math.min(y0 + h, r.yb); gy++) for (let gx = Math.max(x0, r.xa); gx < Math.min(x0 + w, r.xb); gx++) if (inside[at(gx, gy)] || canGrow(gx, gy)) t++
        return t
      }
      for (let i = 0; i < 80 && total(rectOf()) < minTiles; i++) {
        if (hw <= hh * 1.5) hw += 0.5
        else hh += 0.5
      }
      const r = rectOf()
      for (let gy = Math.max(y0, r.ya); gy < Math.min(y0 + h, r.yb); gy++) for (let gx = Math.max(x0, r.xa); gx < Math.min(x0 + w, r.xb); gx++) if (canGrow(gx, gy)) inside[at(gx, gy)] = 1
      grown = true
    }
  }

  const ringMask = inside.slice()
  // Ordinary house lots: taken whole when a third or more lies inside (any of it after growth), otherwise left out of the area.
  const seen = new Set<House>()
  const lots = new Set<House>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const house = houseAt(grid.index(x0 + x, y0 + y))
      if (!house || seen.has(house)) continue
      seen.add(house)
      let inn = 0
      for (let j = house.y; j < house.y + house.h; j++) for (let i = house.x; i < house.x + house.w; i++) if (i >= x0 && j >= y0 && i < x0 + w && j < y0 + h && inside[at(i, j)]) inn++
      const take = grown ? inn > 0 : inn >= house.w * house.h * LOT_SHARE
      if (take && inn > 0) lots.add(house)
      for (let j = house.y; j < house.y + house.h; j++) {
        for (let i = house.x; i < house.x + house.w; i++) {
          if (i < x0 || j < y0 || i >= x0 + w || j >= y0 + h) continue
          const k = at(i, j)
          if (take) {
            if (!isStreet(grid.terrain[grid.index(i, j)]) && loaded(i, j) && !(grown && keep.has(grid.index(i, j)))) {
              inside[k] = 1
            }
          } else if (area.mode === 'grounds' || !ringMask[k]) inside[k] = 0
        }
      }
    }
  }

  // Which tiles are buildings: footprints are all building; grounds keep the map's building tiles.
  const isBuilding = new Uint8Array(w * h)
  for (let k = 0; k < inside.length; k++) {
    if (!inside[k]) continue
    const gx = x0 + (k % w)
    const gy = y0 + Math.floor(k / w)
    if (area.mode === 'footprint' ? ringMask[k] : grid.terrain[grid.index(gx, gy)] === Terrain.building) isBuilding[k] = 1
  }
  const buildingAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && isBuilding[y * w + x] === 1

  // Courtyards (L12.2): big, mostly filled buildings of grounds get an inset yard, closed or open to the south.
  const courtMask = new Uint8Array(w * h)
  const courts = new Map<string, { x0: number; y0: number; x1: number; y1: number }>()
  if (area.mode === 'grounds') {
    const pre = new Uint8Array(w * h)
    for (let k = 0; k < pre.length; k++) pre[k] = isBuilding[k] ? Role.roof : 0
    const { list } = groupBuildings(pre, w, h, x0, y0)
    const idHash = strHash(mark.id)
    for (const b of list) {
      const bw = b.x1 - b.x0 + 1
      const bh = b.y1 - b.y0 + 1
      if (bw < 7 || bh < 7 || b.tiles < 0.75 * bw * bh) continue
      const inset = Math.max(2, Math.min(4, Math.floor(Math.min(bw, bh) / 4)))
      const open = (hash(b.x0 + idHash, b.y0) >> 3) % 3 === 0
      const c = { x0: b.x0 + inset, y0: b.y0 + inset, x1: b.x1 - inset, y1: open ? b.y1 : b.y1 - inset }
      if (c.x1 - c.x0 + 1 < 3 || c.y1 - c.y0 + 1 < 3) continue
      for (let gy = c.y0; gy <= c.y1; gy++) {
        for (let gx = c.x0; gx <= c.x1; gx++) {
          const k = at(gx, gy)
          if (isBuilding[k]) {
            isBuilding[k] = 0
            courtMask[k] = 1
          }
        }
      }
      courts.set(`${b.x0},${b.y0}`, c)
    }
  }

  const roles = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (isBuilding[k]) roles[k] = buildingAt(x, y + 1) ? Role.roof : Role.wall
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!inside[k] || isBuilding[k]) continue
      if (courtMask[k]) {
        roles[k] = Role.court
        continue
      }
      let near = false
      let close = false
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!buildingAt(x + dx, y + dy)) continue
          close = true
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) near = true
        }
      }
      const gx = x0 + x
      const gy = y0 + y
      roles[k] = near ? Role.paving : !close && hash(gx, gy) % 13 === 0 ? Role.tree : Role.lawn
    }
  }

  const { list: buildings, at: groupAt } = groupBuildings(roles, w, h, x0, y0)
  const group = new Int16Array(w * h)
  for (let k = 0; k < group.length; k++) group[k] = groupAt[k]!
  const feat = new Uint8Array(w * h)
  const shade = new Uint8Array(w * h)
  const props: Prop[] = []
  const campus: Campus = { kind: mark.kind, id: mark.id, mode: area.mode, x0, y0, w, h, roles, feat, group, shade, props, buildings }

  // Variants (L12.1): greedy colouring of the neighbour graph, the search starting at a hash of id and position.
  const traits = VARIANT_TRAITS[mark.kind]
  const V = traits.length
  const idHash = strHash(mark.id)
  buildings.forEach((b, i) => {
    const used = new Map<number, number>()
    for (let j = 0; j < i; j++) {
      const o = buildings[j]!
      if (b.x0 - ADJ_GAP <= o.x1 && o.x0 - ADJ_GAP <= b.x1 && b.y0 - ADJ_GAP <= o.y1 && o.y0 - ADJ_GAP <= b.y1) used.set(o.variant, (used.get(o.variant) ?? 0) + 1)
    }
    const start = hash(b.x0 + idHash, b.y0 + (idHash >>> 11)) % V
    let pick = start
    let best = Infinity
    for (let o = 0; o < V; o++) {
      const v = (start + o) % V
      const c = used.get(v) ?? 0
      if (c < best) {
        best = c
        pick = v
      }
    }
    b.variant = pick
    b.storeys = mark.kind === 'hospital' ? 2 : 1 + ((hash(b.y0, b.x0 + idHash) >> 5) & 1)
    const c = courts.get(`${b.x0},${b.y0}`)
    if (c) b.court = c
  })
  // The court was found on the pre-grouping box; the final box is the same building.
  for (const b of buildings) {
    if (b.court) continue
    for (const [key, c] of courts) {
      const [cx, cy] = key.split(',').map(Number) as [number, number]
      if (cx === b.x0 && cy === b.y0) b.court = c
    }
  }
  // Court paths: the middle row and column of each court.
  for (const b of buildings) {
    const c = b.court
    if (!c) continue
    const mx = Math.floor((c.x0 + c.x1) / 2)
    const my = Math.floor((c.y0 + c.y1) / 2)
    for (let gy = c.y0; gy <= c.y1; gy++) for (let gx = c.x0; gx <= c.x1; gx++) if (gx === mx || gy === my) feat[at(gx, gy)] = Feat.courtPath
  }

  if (buildings.length) {
    // The main building holds the sight's point, else is the nearest group within three tiles, else the biggest.
    const p = grid.toTileXY(mark)
    const px = Math.floor(p.x)
    const py = Math.floor(p.y)
    let main = -1
    let bestD = 4
    for (let y = Math.max(0, py - 3 - y0); y <= Math.min(h - 1, py + 3 - y0); y++) {
      for (let x = Math.max(0, px - 3 - x0); x <= Math.min(w - 1, px + 3 - x0); x++) {
        const g = groupAt[y * w + x]!
        if (g < 0) continue
        const d = Math.max(Math.abs(x0 + x - px), Math.abs(y0 + y - py))
        if (d < bestD || (d === bestD && buildings[g]!.tiles > (buildings[main]?.tiles ?? 0))) {
          main = g
          bestD = d
        }
      }
    }
    if (main < 0) main = buildings.reduce((best, b, i) => (b.tiles > buildings[best]!.tiles ? i : best), 0)
    campus.main = main
  }

  // --- Roofs (L13.1): slopes and a ridge on pitched roofs, skylights on flat ones, planters on terraces.
  buildings.forEach((b, i) => {
    const kindOf = traits[b.variant]!
    for (let gy = b.y0; gy <= b.y1; gy++) {
      for (let gx = b.x0; gx <= b.x1; gx++) {
        const k = at(gx, gy)
        if (group[k] !== i || roles[k] !== Role.roof) continue
        if (kindOf.roofKind === 'pitched') {
          const m = (gy - b.y0) % 6
          feat[k] = m < 2 ? Feat.slopeA : m === 2 ? Feat.ridge : Feat.slopeB
        } else if (kindOf.roofKind === 'flat') {
          if (hash(gx, gy) % 5 === 0) feat[k] = Feat.skylight
        } else if (hash(gx, gy) % 6 === 0) feat[k] = Feat.planter
      }
    }
  })

  // --- Entrances (L12.4).
  const streetTile = (gx: number, gy: number) => {
    if (!grid.inBounds(gx, gy)) return false
    const t = grid.terrain[grid.index(gx, gy)]
    return t === Terrain.road || t === Terrain.path || t === Terrain.crossing || t === Terrain.plaza || keep.has(grid.index(gx, gy))
  }
  /** A tile steps, plaza and shadow may use (see the design, "Free tile"). */
  const freeTile = (gx: number, gy: number) => {
    if (!inBox(gx, gy) || !loaded(gx, gy)) return false
    const idx = grid.index(gx, gy)
    const t = grid.terrain[idx]
    if (isStreet(t) || keep.has(idx)) return false
    const k = at(gx, gy)
    const r = roles[k]!
    if (r === Role.roof || r === Role.wall || r === Role.court) return false
    if (t === Terrain.building && !inside[k]) return false
    const hs = houseAt(idx)
    if (hs && !inside[k] && !lots.has(hs)) return false
    return true
  }
  const plazaHalf = mark.kind === 'school' ? 2 : mark.kind === 'townHall' ? 2 : 1
  const plazaDepth = mark.kind === 'townHall' ? 3 : 2
  const mainIdx = campus.main ?? -1
  buildings.forEach((b, bi) => {
    if (b.tiles < 3) return
    const mx = Math.floor((b.x0 + b.x1) / 2)
    const my = Math.floor((b.y0 + b.y1) / 2)
    const dist: Record<Side, number> = { N: 99, E: 99, S: 99, W: 99 }
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      const [dx, dy] = SIDES[side]
      const sx = side === 'E' ? b.x1 : side === 'W' ? b.x0 : mx
      const sy = side === 'S' ? b.y1 : side === 'N' ? b.y0 : my
      for (let d = 1; d <= STREET_SEARCH; d++) {
        if (streetTile(sx + dx * d, sy + dy * d)) {
          dist[side] = d
          break
        }
      }
    }
    const minD = Math.min(dist.N, dist.E, dist.S, dist.W)
    const rank = (['S', 'W', 'E', 'N'] as const).slice().sort((p, q) => dist[p] - dist[q])
    // South wins when nothing is near or when it is within 2 tiles of the nearest street.
    const order: Side[] = minD >= 99 || dist.S <= minD + 2 ? ['S', ...rank.filter((r) => r !== 'S')] : rank
    for (const side of order) {
      const [dx, dy] = SIDES[side]
      // Candidate door tiles: the building's edge tiles on that side, nearest the middle first.
      const horizontal = side === 'N' || side === 'S'
      const mid = horizontal ? mx : my
      let found: { x: number; y: number } | undefined
      for (let o = 0; o <= 40 && !found; o = o <= 0 ? 1 - o : -o) {
        const c = mid + o
        // The outermost tile of this group in that column or row.
        let edge: { x: number; y: number } | undefined
        if (horizontal) {
          for (let gy = side === 'S' ? b.y1 : b.y0; side === 'S' ? gy >= b.y0 : gy <= b.y1; gy += side === 'S' ? -1 : 1) {
            if (c >= x0 && c < x0 + w && group[at(c, gy)] === bi && isBuildingRole(roles[at(c, gy)]!)) {
              edge = { x: c, y: gy }
              break
            }
          }
        } else {
          for (let gx = side === 'E' ? b.x1 : b.x0; side === 'E' ? gx >= b.x0 : gx <= b.x1; gx += side === 'E' ? -1 : 1) {
            if (c >= y0 && c < y0 + h && group[at(gx, c)] === bi && isBuildingRole(roles[at(gx, c)]!)) {
              edge = { x: gx, y: c }
              break
            }
          }
        }
        if (edge && freeTile(edge.x + dx, edge.y + dy)) found = edge
      }
      if (!found) continue
      b.door = { x: found.x, y: found.y, side }
      const kd = at(found.x, found.y)
      feat[kd] = side === 'S' ? Feat.door : side === 'N' ? Feat.canopyN : side === 'E' ? Feat.canopyE : Feat.canopyW
      const ks = at(found.x + dx, found.y + dy)
      roles[ks] = Role.steps
      feat[ks] = side === 'S' ? Feat.stepsS : side === 'N' ? Feat.stepsN : side === 'E' ? Feat.stepsE : Feat.stepsW
      // The plaza beyond the steps, `plazaDepth` deep and `2 × plazaHalf + 1` wide, on free tiles only.
      for (let d = 2; d < 2 + plazaDepth; d++) {
        for (let l = -plazaHalf; l <= plazaHalf; l++) {
          const gx = found.x + dx * d + (horizontal ? l : 0)
          const gy = found.y + dy * d + (horizontal ? 0 : l)
          if (!freeTile(gx, gy)) continue
          const k = at(gx, gy)
          roles[k] = Role.paving
          feat[k] = Feat.none
          if (mark.kind === 'hospital') feat[k] = Feat.bay
          else if (mark.kind === 'school' && d === 1 + plazaDepth && l !== 0) feat[k] = side === 'S' ? Feat.fence : side === 'N' ? Feat.fenceN : side === 'E' ? Feat.fenceE : Feat.fenceW
          else if (mark.kind === 'temple' && d === 2 && l === 0) feat[k] = horizontal ? Feat.gate : Feat.gateV
        }
      }
      break
    }
  })

  // --- The main building: portico, pediment, balcony, rose window, flagpoles (L12.3, L14.2).
  const main = campus.main !== undefined ? buildings[campus.main] : undefined
  if (main?.door && main.door.side === 'S') {
    const d = main.door
    const wallAt = (gx: number, gy: number) => inBox(gx, gy) && group[at(gx, gy)] === mainIdx && roles[at(gx, gy)] === Role.wall
    const roofAt = (gx: number, gy: number) => inBox(gx, gy) && group[at(gx, gy)] === mainIdx && roles[at(gx, gy)] === Role.roof
    const reach = mark.kind === 'townHall' ? 2 : mark.kind === 'university' ? 1 : 0
    for (let o = 1; o <= reach; o++) for (const s of [-1, 1]) if (wallAt(d.x + s * o, d.y)) feat[at(d.x + s * o, d.y)] = Feat.portico
    if (mark.kind === 'university' && roofAt(d.x, d.y - 1)) feat[at(d.x, d.y - 1)] = Feat.pediment
    if (mark.kind === 'church' && roofAt(d.x, d.y - 1)) feat[at(d.x, d.y - 1)] = Feat.rose
    if (mark.kind === 'townHall') for (let o = -1; o <= 1; o++) if (roofAt(d.x + o, d.y - 1)) feat[at(d.x + o, d.y - 1)] = Feat.balcony
    if (mark.kind === 'townHall' || mark.kind === 'university') {
      // The widest symmetrical pair of façade tiles (at least 2 from the door), in line with the entrance.
      for (let half = Math.min(Math.floor((main.x1 - main.x0) / 2) - 1, 6); half >= 2; half--) {
        if (wallAt(d.x - half, d.y) && wallAt(d.x + half, d.y)) {
          props.push({ type: 'pole', x: d.x - half + 0.5, y: d.y + 1, seed: 0 }, { type: 'pole', x: d.x + half + 0.5, y: d.y + 1, seed: 1 })
          break
        }
      }
    }
  }
  // Chimneys and cupolas of the variants that have them.
  buildings.forEach((b, i) => {
    const t = traits[b.variant]!
    if (b.tiles < 6) return
    if (t.chimney) {
      let n = 0
      for (let gy = b.y0; gy <= b.y1 && n < 2; gy++) {
        for (let gx = b.x0; gx <= b.x1 && n < 2; gx++) {
          const k = at(gx, gy)
          if (group[k] === i && roles[k] === Role.roof && hash(gx + 7, gy + 3) % 9 === 0 && feat[k] !== Feat.ridge) {
            props.push({ type: 'chimney', x: gx + 0.5, y: gy + 0.8, seed: hash(gx, gy) })
            n++
          }
        }
      }
    }
    if (t.cupola && b.x1 - b.x0 >= 3 && b.y1 - b.y0 >= 3) {
      const cx = Math.floor((b.x0 + b.x1) / 2)
      const cy = Math.floor((b.y0 + b.y1) / 2)
      if (group[at(cx, cy)] === i && roles[at(cx, cy)] === Role.roof) props.push({ type: 'cupola', x: cx + 0.5, y: cy + 0.9, seed: hash(cx, cy) })
    }
  })

  // --- Drop shadow (L13.1): light from the north-west, so the strip lies east and south of each building.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBuildingRole(roles[y * w + x]!)) continue
      const gx = x0 + x
      const gy = y0 + y
      const e = [gx + 1, gy] as const
      const so = [gx, gy + 1] as const
      for (const [bit, t] of [[1, e], [2, so]] as const) {
        const [tx, ty] = t
        if (!inBox(tx, ty) || !loaded(tx, ty)) continue
        const k = at(tx, ty)
        const r = roles[k]!
        if (r === Role.roof || r === Role.wall) continue
        const terr = grid.terrain[grid.index(tx, ty)]
        if (isStreet(terr) || (r === Role.none && terr === Terrain.building)) continue
        shade[k] = shade[k]! | bit
      }
    }
  }

  // --- The crown: on the main building, in line with its entrance when that faces south.
  if (main && main.x1 - main.x0 + 1 >= CROWN_MIN_W && main.tiles >= CROWN_MIN_TILES) {
    // Behind the façade: the crown stands on the roof row above the door, so doors, columns and balcony stay visible.
    if (main.door?.side === 'S') campus.crown = { x: main.door.x + 0.5, y: Math.max(main.y0 + 1, main.door.y - 1) }
    else {
      const mid = (main.x0 + main.x1 + 1) / 2
      let bestX = main.x0
      let bestY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (groupAt[y * w + x] !== campus.main) continue
          const gy = y0 + y
          const gx = x0 + x
          if (gy > bestY || (gy === bestY && Math.abs(gx + 0.5 - mid) < Math.abs(bestX + 0.5 - mid))) {
            bestY = gy
            bestX = gx
          }
        }
      }
      campus.crown = { x: bestX + 0.5, y: bestY + 1 }
    }
  }
  return campus
}

/** The role at a grid tile, or none outside the map of the campus. */
export function roleAt(c: Campus, gx: number, gy: number): RoleId {
  if (gx < c.x0 || gy < c.y0 || gx >= c.x0 + c.w || gy >= c.y0 + c.h) return Role.none
  return c.roles[(gy - c.y0) * c.w + (gx - c.x0)] as RoleId
}

/** The feature byte at a grid tile (`Feat.none` outside). */
export function featAt(c: Campus, gx: number, gy: number): number {
  if (gx < c.x0 || gy < c.y0 || gx >= c.x0 + c.w || gy >= c.y0 + c.h) return Feat.none
  return c.feat[(gy - c.y0) * c.w + (gx - c.x0)]!
}

/** The shadow bits at a grid tile (1 east of a building, 2 south of one). */
export function shadeAt(c: Campus, gx: number, gy: number): number {
  if (gx < c.x0 || gy < c.y0 || gx >= c.x0 + c.w || gy >= c.y0 + c.h) return 0
  return c.shade[(gy - c.y0) * c.w + (gx - c.x0)]!
}
