import { Terrain, type TileGrid } from '../tiles/grid.ts'
import { analyseBlocks, components, largestRect, subdivide } from './blocks.ts'
import { houseKind, placeHouses } from './houses.ts'
import { findParkGates, LANDMARK_RADIUS, LANDMARK_SIZES, landmarkSites, placeLandmarks } from './landmarks.ts'
import { hash2, rng } from './random.ts'
import { LOT, ROOF_COLOURS, WALL_COLOURS, type House, type HouseKind, type Landmark, type Rect, type StructureKind, type TownLayout } from './types.ts'

/**
 * Turns the raw building footprints into a town: landmark points become special
 * buildings, footpaths into big parks get gates, and every remaining block is
 * cut into house-sized lots with gardens. Everything is deterministic for a
 * given grid: the input order of the map data never matters.
 *
 * Modules (this file only wires them together and keeps the public names):
 * - `types.ts`     shapes and constants
 * - `random.ts`    seeded PRNG and tile hash
 * - `blocks.ts`    block analysis and lot geometry (BSP, largest rectangle)
 * - `landmarks.ts` landmark and park-gate placement
 * - `houses.ts`    house, yard and tree placement
 */

export { analyseBlocks, components, findParkGates, hash2, houseKind, largestRect, LANDMARK_RADIUS, LANDMARK_SIZES, landmarkSites, LOT, placeHouses, placeLandmarks, rng, ROOF_COLOURS, subdivide, WALL_COLOURS }
export type { House, HouseKind, Landmark, Rect, StructureKind, TownLayout }

/**
 * `keepOut` marks tiles landmarks and park gates may not use (a streamed cell keeps them on its own
 * tiles); it is copied, not changed. `housesOn` (a streamed cell) marks the building tiles whose
 * houses this layout builds, whole, even where they reach past `keepOut`: houses go only on those
 * tiles and never on landmark or gate tiles. Without it, houses follow `keepOut` too.
 */
export function layoutTown(grid: TileGrid, keepOut?: Uint8Array, housesOn?: Uint8Array): TownLayout {
  const n = grid.cols * grid.rows
  // Tiles taken by landmarks and gates; houses are only placed on the rest.
  const reserved = keepOut ? Uint8Array.from(keepOut) : new Uint8Array(n)
  // A building another cell owns is that cell's to build on, so no landmark stands on it here.
  if (housesOn) for (let i = 0; i < n; i++) if (grid.terrain[i] === Terrain.building && !housesOn[i]) reserved[i] = 1
  const special = placeLandmarks(grid, reserved)
  const gates = findParkGates(grid, reserved)
  const landmarks = [...special, ...gates]
  const landmarkAt = new Int32Array(n).fill(-1)
  landmarks.forEach((l, k) => {
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) landmarkAt[grid.index(x, y)] = k
  })
  let forHouses = reserved
  if (housesOn) {
    forHouses = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (!housesOn[i]) forHouses[i] = 1
    for (const l of landmarks) for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) forHouses[grid.index(x, y)] = 1
  }
  const { houses, houseAt, trees, fences, gates: gateTiles } = placeHouses(grid, forHouses)
  return { houses, landmarks, houseAt, landmarkAt, trees, fences, gates: gateTiles }
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
