import { LANDMARK_KINDS, type LandmarkKind, type Poi } from '../osm/types.ts'
import { PARK_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'
import { components } from './blocks.ts'
import type { Landmark, Rect } from './types.ts'

/**
 * Landmark placement: special buildings at map points and park gates where a
 * footpath enters a big park. Both write the tiles they take into `reserved`,
 * so houses, other landmarks and gates never share a tile.
 */

/** Landmark footprints in tiles (w × h), largest first; smaller fallbacks are tried when space is tight. */
export const LANDMARK_SIZES: Record<LandmarkKind, readonly (readonly [number, number])[]> = {
  healing: [[7, 5], [6, 5], [5, 4]],
  station: [[7, 4], [6, 4], [5, 3]],
  school: [[8, 5], [7, 5], [6, 4]],
  greenMarket: [[7, 5], [6, 4], [5, 4]],
  market: [[6, 4], [5, 4], [4, 3]],
}

/** How far (tiles) from its point a landmark may be moved to find room. */
export const LANDMARK_RADIUS = 9

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
}

function mark(grid: TileGrid, reserved: Uint8Array, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) reserved[grid.index(x, y)] = 1
}

/**
 * Where a landmark may stand. Pass 0: only on building footprints. Pass 1: at
 * least half on buildings, the rest on open ground. Pass 2: any open ground or
 * plaza (metro stations often sit in a square with no building).
 */
function fits(grid: TileGrid, reserved: Uint8Array, r: Rect, pass: number): boolean {
  const strict = pass === 0
  if (r.x < 0 || r.y < 0 || r.x + r.w > grid.cols || r.y + r.h > grid.rows) return false
  let building = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = grid.index(x, y)
      if (reserved[i]) return false
      const t = grid.terrain[i]
      if (t === Terrain.building) building++
      else if (strict || (t !== Terrain.ground && t !== Terrain.park && !(pass === 2 && t === Terrain.plaza))) return false
    }
  }
  return pass !== 1 || building >= r.w * r.h * 0.5
}

type Site = { kind: LandmarkKind; x: number; y: number }

/**
 * The points that can become landmarks, in a fixed order: by kind (the order of
 * `LANDMARK_KINDS`), then row, then column of their tile. Points of an unknown
 * kind, with a non-finite position or outside the map are dropped, and several
 * points of one kind on one tile count once. The order of `grid.pois` never
 * matters, so the same map data gives the same town however it was listed.
 */
export function landmarkSites(grid: TileGrid): Site[] {
  const sites: Site[] = []
  for (const poi of grid.pois as readonly Poi[]) {
    if (!LANDMARK_KINDS.includes(poi.kind) || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lon)) continue
    const t = grid.toTileXY(poi)
    const x = Math.floor(t.x)
    const y = Math.floor(t.y)
    if (grid.inBounds(x, y)) sites.push({ kind: poi.kind, x, y })
  }
  const rank = (k: LandmarkKind) => LANDMARK_KINDS.indexOf(k)
  sites.sort((a, b) => rank(a.kind) - rank(b.kind) || a.y - b.y || a.x - b.x)
  return sites.filter((s, i) => {
    const p = sites[i - 1]
    return !p || p.kind !== s.kind || p.x !== s.x || p.y !== s.y
  })
}

/** Place each landmark point as a building of its kind as close to the point as space allows. */
export function placeLandmarks(grid: TileGrid, reserved: Uint8Array, radius = LANDMARK_RADIUS): Landmark[] {
  const out: Landmark[] = []
  for (const site of landmarkSites(grid)) {
    const { x: px, y: py } = site
    // A second point inside a landmark of its own kind is the same place (entrances of one station).
    if (out.some((l) => l.kind === site.kind && inRect(l, px, py))) continue
    let placed: Landmark | undefined
    search: for (const pass of [0, 1, 2]) {
      for (const [w, h] of LANDMARK_SIZES[site.kind]) {
        let best: Rect | undefined
        let bestD = Infinity
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const r = { x: px + dx - Math.floor(w / 2), y: py + dy - Math.floor(h / 2), w, h }
            const d = dx * dx + dy * dy
            if (d >= bestD || d > radius * radius) continue
            if (fits(grid, reserved, r, pass)) {
              best = r
              bestD = d
            }
          }
        }
        if (best) {
          placed = { kind: site.kind, ...best }
          break search
        }
      }
    }
    if (!placed) continue
    out.push(placed)
    mark(grid, reserved, placed)
  }
  return out
}

const GATE_STYLES = new Set([PARK_STYLES.indexOf('park'), PARK_STYLES.indexOf('garden')])

/**
 * Park entrances: a footpath tile that steps from outside into a big park,
 * with park on both sides of it. At most `perPark` per park, spread apart.
 * A gate must lie inside the map and on tiles nobody else has taken (`reserved`);
 * the tiles it takes are added to `reserved`.
 */
export function findParkGates(grid: TileGrid, reserved: Uint8Array = new Uint8Array(grid.cols * grid.rows), minParkTiles = 120, perPark = 2): Landmark[] {
  const parkIndex = new Int32Array(grid.cols * grid.rows).fill(-1)
  const parks = components(grid, (i) => grid.terrain[i] === Terrain.park && GATE_STYLES.has(grid.style[i] ?? 0))
  parks.forEach((comp, k) => {
    if (comp.length >= minParkTiles) for (const i of comp) parkIndex[i] = k
  })
  const isPark = (x: number, y: number) => grid.inBounds(x, y) && (parkIndex[grid.index(x, y)] ?? -1) >= 0
  const parkOf = (x: number, y: number) => (grid.inBounds(x, y) ? (parkIndex[grid.index(x, y)] ?? -1) : -1)
  const isPathy = (x: number, y: number) => {
    const t = grid.terrainAt(x, y)
    return t === Terrain.path || t === Terrain.plaza
  }
  const free = (r: Rect) => {
    if (r.x < 0 || r.y < 0 || r.x + r.w > grid.cols || r.y + r.h > grid.rows) return false
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (reserved[grid.index(x, y)]) return false
    return true
  }
  const found = new Map<number, Landmark[]>()
  for (let y = 1; y < grid.rows - 1; y++) {
    for (let x = 1; x < grid.cols - 1; x++) {
      if (grid.terrainAt(x, y) !== Terrain.path) continue
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        // Moving in (dx, dy) enters the park: sides are park, behind is outside.
        const sideA = dx === 0 ? [x - 1, y] : [x, y - 1]
        const sideB = dx === 0 ? [x + 1, y] : [x, y + 1]
        const park = parkOf(sideA[0]!, sideA[1]!)
        if (park < 0 || parkOf(sideB[0]!, sideB[1]!) !== park) continue
        const bx = x - dx
        const by = y - dy
        if (isPark(bx, by) || isPark(bx - (dx === 0 ? 1 : 0), by - (dx === 0 ? 0 : 1))) continue
        if (!isPathy(x + dx, y + dy) && !isPark(x + dx, y + dy)) continue
        const list = found.get(park) ?? []
        if (list.length >= perPark) continue
        if (list.some((g) => Math.abs(g.x - x) + Math.abs(g.y - y) < 30)) continue
        const vertical = dx === 0
        // The rectangle includes one row above for the arch sign.
        const gate: Landmark = vertical ? { kind: 'parkGate', x: x - 1, y: y - 1, w: 3, h: 2, vertical } : { kind: 'parkGate', x, y: y - 2, w: 1, h: 4, vertical }
        if (!free(gate)) continue
        for (let yy = gate.y; yy < gate.y + gate.h; yy++) for (let xx = gate.x; xx < gate.x + gate.w; xx++) reserved[grid.index(xx, yy)] = 1
        list.push(gate)
        found.set(park, list)
      }
    }
  }
  return [...found.values()].flat()
}
