import type { LandmarkKind } from '../osm/types.ts'
import { diagonalCorners, rampAt } from '../tiles/diagonal.ts'
import { BUILDING_STYLES, PARK_STYLES, Terrain, type TileGrid } from '../tiles/grid.ts'

/**
 * Turns the raw building footprints into a town: every block is cut into
 * house-sized lots, each lot gets one house (with a front garden or side
 * garden when there is room), and special buildings are placed at landmark
 * points. Everything is deterministic for a given grid.
 */

export type HouseKind = 'house' | 'apartments' | 'warehouse'

export type House = {
  x: number
  y: number
  w: number
  h: number
  kind: HouseKind
  /** Index into the roof palette. */
  roof: number
  /** Index into the wall palette. */
  wall: number
  /** Door column, relative to x. */
  door: number
  /** Per-house random seed for small details. */
  seed: number
  /** The lot row under the house is a front garden (fence + gate). */
  frontYard: boolean
}

export type StructureKind = LandmarkKind | 'parkGate'

export type Landmark = {
  kind: StructureKind
  x: number
  y: number
  w: number
  h: number
  /** Park gates: the path runs north–south (true) or east–west (false). */
  vertical?: boolean
}

export type TownLayout = {
  houses: House[]
  landmarks: Landmark[]
  /** Tile → house index, or -1. */
  houseAt: Int32Array
  /** Tile → landmark index, or -1. */
  landmarkAt: Int32Array
  /** Garden trees on lot tiles (tile indices). */
  trees: Set<number>
  /** Lot tiles that carry a front fence on their south edge. */
  fences: Set<number>
  /** Lot tiles that are the garden gate (path from the door to the street). */
  gates: Set<number>
}

export type Rect = { x: number; y: number; w: number; h: number }

/** Landmark footprints in tiles (w × h), largest first; smaller fallbacks are tried when space is tight. */
export const LANDMARK_SIZES: Record<LandmarkKind, readonly (readonly [number, number])[]> = {
  healing: [[7, 5], [6, 5], [5, 4]],
  station: [[7, 4], [6, 4], [5, 3]],
  school: [[8, 5], [7, 5], [6, 4]],
  greenMarket: [[7, 5], [6, 4], [5, 4]],
  market: [[6, 4], [5, 4], [4, 3]],
}

export const LOT = { minW: 4, maxW: 7, minH: 4, maxH: 6 } as const
export const ROOF_COLOURS = 6
export const WALL_COLOURS = 4

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * Binary space partition: cut a rectangle into lots no bigger than max and
 * (where possible) no smaller than min, alternating on the longer side.
 */
export function subdivide(rect: Rect, random: () => number, opts: { minW: number; maxW: number; minH: number; maxH: number } = LOT): Rect[] {
  const out: Rect[] = []
  const stack: Rect[] = [rect]
  while (stack.length) {
    const r = stack.pop()!
    const splitW = r.w > opts.maxW && r.w >= opts.minW * 2
    const splitH = r.h > opts.maxH && r.h >= opts.minH * 2
    if (!splitW && !splitH) {
      out.push(r)
      continue
    }
    const vertical = splitW && (!splitH || r.w / opts.maxW >= r.h / opts.maxH)
    if (vertical) {
      const cut = opts.minW + Math.floor(random() * (r.w - opts.minW * 2 + 1))
      stack.push({ x: r.x, y: r.y, w: cut, h: r.h }, { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h })
    } else {
      const cut = opts.minH + Math.floor(random() * (r.h - opts.minH * 2 + 1))
      stack.push({ x: r.x, y: r.y, w: r.w, h: cut }, { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut })
    }
  }
  return out
}

/** Largest axis-aligned rectangle of true cells in a w × h mask (row-major). */
export function largestRect(mask: ArrayLike<boolean | number>, w: number, h: number): Rect | undefined {
  const heights = new Array<number>(w).fill(0)
  let best: Rect | undefined
  let bestArea = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? (heights[x] ?? 0) + 1 : 0
    // Histogram stack algorithm.
    const stack: number[] = []
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? (heights[x] ?? 0) : 0
      while (stack.length && (heights[stack[stack.length - 1]!] ?? 0) >= cur) {
        const top = stack.pop()!
        const height = heights[top] ?? 0
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0
        const width = x - left
        const area = width * height
        // Prefer wider rectangles on ties (houses read better wide).
        if (height > 0 && (area > bestArea || (area === bestArea && best && width > best.w))) {
          bestArea = area
          best = { x: left, y: y - height + 1, w: width, h: height }
        }
      }
      stack.push(x)
    }
  }
  return best
}

/** Connected components (4-neighbour) of tiles matching `inside`. */
export function components(grid: TileGrid, inside: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(grid.cols * grid.rows)
  const out: number[][] = []
  const stack: number[] = []
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !inside(i)) continue
    const comp: number[] = []
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      comp.push(j)
      const x = j % grid.cols
      const y = (j - x) / grid.cols
      const visit = (k: number) => {
        if (!seen[k] && inside(k)) {
          seen[k] = 1
          stack.push(k)
        }
      }
      if (x > 0) visit(j - 1)
      if (x < grid.cols - 1) visit(j + 1)
      if (y > 0) visit(j - grid.cols)
      if (y < grid.rows - 1) visit(j + grid.cols)
    }
    out.push(comp)
  }
  return out
}

function isBuilding(grid: TileGrid, i: number): boolean {
  return grid.terrain[i] === Terrain.building
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

/** Place each landmark point as a building of its kind as close to the point as space allows. */
export function placeLandmarks(grid: TileGrid, reserved: Uint8Array, radius = 9): Landmark[] {
  const out: Landmark[] = []
  for (const poi of grid.pois) {
    const t = grid.toTileXY(poi)
    const px = Math.floor(t.x)
    const py = Math.floor(t.y)
    if (!grid.inBounds(px, py)) continue
    let placed: Landmark | undefined
    search: for (const pass of [0, 1, 2]) {
      for (const [w, h] of LANDMARK_SIZES[poi.kind]) {
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
          placed = { kind: poi.kind, ...best }
          break search
        }
      }
    }
    if (!placed) continue
    out.push(placed)
    for (let y = placed.y; y < placed.y + placed.h; y++) for (let x = placed.x; x < placed.x + placed.w; x++) reserved[grid.index(x, y)] = 1
  }
  return out
}

const GATE_STYLES = new Set([PARK_STYLES.indexOf('park'), PARK_STYLES.indexOf('garden')])

/**
 * Park entrances: a footpath tile that steps from outside into a big park,
 * with park on both sides of it. At most `perPark` per park, spread apart.
 */
export function findParkGates(grid: TileGrid, minParkTiles = 120, perPark = 2): Landmark[] {
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
        list.push(vertical ? { kind: 'parkGate', x: x - 1, y: y - 1, w: 3, h: 2, vertical } : { kind: 'parkGate', x, y: y - 2, w: 1, h: 4, vertical })
        found.set(park, list)
      }
    }
  }
  return [...found.values()].flat()
}

/** Pick a house style from its size and the tagged building type. */
export function houseKind(w: number, h: number, buildingStyle: string): HouseKind {
  if (buildingStyle === 'industrial') return 'warehouse'
  if (buildingStyle === 'house') return 'house'
  return w * h >= 30 || h >= 5 ? 'apartments' : 'house'
}

export function layoutTown(grid: TileGrid): TownLayout {
  const n = grid.cols * grid.rows
  const reserved = new Uint8Array(n)
  const landmarks = placeLandmarks(grid, reserved)
  const gates = findParkGates(grid)
  const all = [...landmarks, ...gates]
  const landmarkAt = new Int32Array(n).fill(-1)
  all.forEach((l, k) => {
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) if (grid.inBounds(x, y)) landmarkAt[grid.index(x, y)] = k
  })

  const houses: House[] = []
  const houseAt = new Int32Array(n).fill(-1)
  const trees = new Set<number>()
  const fences = new Set<number>()
  const gateTiles = new Set<number>()
  const blocks = components(grid, (i) => isBuilding(grid, i) && !reserved[i])
  for (const block of blocks) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const i of block) {
      const x = i % grid.cols
      const y = (i - x) / grid.cols
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const first = block[0] ?? 0
    const random = rng(hash2(minX, minY) ^ first)
    const inBlock = new Set(block)
    const lots = subdivide({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, random)
    for (const lot of lots) {
      const mask = new Uint8Array(lot.w * lot.h)
      // Tiles cut by a diagonal street corner or ramp stay garden so the smooth kerb shows.
      for (let y = 0; y < lot.h; y++)
        for (let x = 0; x < lot.w; x++) mask[y * lot.w + x] = inBlock.has(grid.index(lot.x + x, lot.y + y)) && diagonalCorners(grid, lot.x + x, lot.y + y) === 0 && !rampAt(grid, lot.x + x, lot.y + y) ? 1 : 0
      // Up to three houses per lot: odd-shaped lots (diagonal blocks) get filled piece by piece.
      for (let k = 0; k < 3; k++) {
        const r = largestRect(mask, lot.w, lot.h)
        if (!r || r.h < 2 || r.w < 2 || r.w * r.h < 4) break
        for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) mask[yy * lot.w + xx] = 0
        let { w, h } = r
        const x = lot.x + r.x
        const y = lot.y + r.y
        // A front garden on taller plots; a side garden on some wide ones.
        const frontYard = h >= 6 || (h >= 5 && random() < 0.5)
        if (frontYard) h -= 1
        if (w >= 7 && random() < 0.4) w -= 1
        const styleCounts = [0, 0, 0]
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) styleCounts[grid.style[grid.index(xx, yy)] ?? 0]!++
        const style = BUILDING_STYLES[styleCounts.indexOf(Math.max(...styleCounts))] ?? 'block'
        const kind = houseKind(w, h, style)
        const seed = hash2(x, y)
        const door = w <= 2 ? 0 : w === 3 ? 1 : 1 + (seed % (w - 2))
        const house: House = { x, y, w, h, kind, roof: seed % ROOF_COLOURS, wall: (seed >>> 8) % WALL_COLOURS, door, seed, frontYard }
        const index = houses.length
        houses.push(house)
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) houseAt[grid.index(xx, yy)] = index
        if (frontYard) {
          const fy = y + h
          for (let xx = x; xx < x + r.w; xx++) {
            const i = grid.index(xx, fy)
            if (!inBlock.has(i)) continue
            // Fence only along a street-facing edge; a gate below the door.
            const open = grid.terrainAt(xx, fy + 1) !== Terrain.building
            if (xx === x + door) gateTiles.add(i)
            else if (open) fences.add(i)
          }
        }
      }
      decorateYard(grid, inBlock, lot, trees, random, houseAt, gateTiles)
    }
  }
  return { houses, landmarks: all, houseAt, landmarkAt, trees, fences, gates: gateTiles }
}

/** Scatter trees on the lot tiles no house uses (back gardens, leftovers). */
function decorateYard(grid: TileGrid, inBlock: Set<number>, lot: Rect, trees: Set<number>, random: () => number, houseAt?: Int32Array, gates?: Set<number>) {
  for (let y = lot.y; y < lot.y + lot.h; y++) {
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      const i = grid.index(x, y)
      if (!inBlock.has(i) || (houseAt && (houseAt[i] ?? -1) >= 0) || gates?.has(i)) continue
      // Keep the tile right under a house clear (front garden), trees elsewhere.
      const aboveHouse = houseAt && y > 0 && (houseAt[i - grid.cols] ?? -1) >= 0
      if (!aboveHouse && random() < 0.18) trees.add(i)
    }
  }
}

const cache = new WeakMap<TileGrid, TownLayout>()

/** Layout for a grid, computed once. */
export function townFor(grid: TileGrid): TownLayout {
  let t = cache.get(grid)
  if (!t) {
    t = layoutTown(grid)
    cache.set(grid, t)
  }
  return t
}
