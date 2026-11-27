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

export const Role = { none: 0, lawn: 1, paving: 2, tree: 3, roof: 4, wall: 5 } as const
export type RoleId = (typeof Role)[keyof typeof Role]

export const isBuildingRole = (r: number): boolean => r === Role.roof || r === Role.wall

/** A group of 8-connected building tiles: its tile box (x1, y1 inclusive) and size. */
export type CampusBuilding = { x0: number; y0: number; x1: number; y1: number; tiles: number }

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
/** A house lot is replaced whole when at least this share of its tiles lies inside the area. */
export const LOT_SHARE = 1 / 3
/** A building group must be at least this wide (tiles) and this big to carry a crown. */
export const CROWN_MIN_W = 3
export const CROWN_MIN_TILES = 8

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
    const b: CampusBuilding = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, tiles: 0 }
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
export function buildCampus(grid: TileGrid, houseAt: (i: number) => House | undefined, mark: SightMark): Campus | undefined {
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
  // A margin of one lot, so a house lot that reaches out of the grounds is taken whole.
  const x0 = Math.max(0, Math.floor(minX) - LOT_MARGIN)
  const y0 = Math.max(0, Math.floor(minY) - LOT_MARGIN)
  const x1 = Math.min(grid.cols - 1, Math.ceil(maxX) + LOT_MARGIN)
  const y1 = Math.min(grid.rows - 1, Math.ceil(maxY) + LOT_MARGIN)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) return undefined
  const inside = fillRings(rings, x0, y0, w, h)
  const at = (gx: number, gy: number) => (gx - x0) + (gy - y0) * w
  const loaded = (gx: number, gy: number) => grid.coveredAt(gx, gy)

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

  const ringMask = inside.slice()
  // Ordinary house lots: taken whole when a third or more lies inside, otherwise left out of the area.
  const seen = new Set<House>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const house = houseAt(grid.index(x0 + x, y0 + y))
      if (!house || seen.has(house)) continue
      seen.add(house)
      let inn = 0
      for (let j = house.y; j < house.y + house.h; j++) for (let i = house.x; i < house.x + house.w; i++) if (i >= x0 && j >= y0 && i < x0 + w && j < y0 + h && inside[at(i, j)]) inn++
      const take = inn >= house.w * house.h * LOT_SHARE
      for (let j = house.y; j < house.y + house.h; j++) {
        for (let i = house.x; i < house.x + house.w; i++) {
          if (i < x0 || j < y0 || i >= x0 + w || j >= y0 + h) continue
          const k = at(i, j)
          if (take) {
            if (!isStreet(grid.terrain[grid.index(i, j)]) && loaded(i, j)) {
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
  const roles = new Uint8Array(w * h)
  const buildingAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && isBuilding[y * w + x] === 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (isBuilding[k]) roles[k] = buildingAt(x, y + 1) ? Role.roof : Role.wall
    }
  }
  {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x
        if (!inside[k] || isBuilding[k]) continue
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
  }

  const { list: buildings, at: groupAt } = groupBuildings(roles, w, h, x0, y0)
  const campus: Campus = { kind: mark.kind, id: mark.id, mode: area.mode, x0, y0, w, h, roles, buildings }
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
    const b = buildings[main]!
    if (b.x1 - b.x0 + 1 >= CROWN_MIN_W && b.tiles >= CROWN_MIN_TILES) {
      // The southernmost tile of the group nearest to its horizontal middle.
      const mid = (b.x0 + b.x1 + 1) / 2
      let bestX = b.x0
      let bestY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (groupAt[y * w + x] !== main) continue
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
