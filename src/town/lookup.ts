import type { House, Landmark, TownLayout } from './types.ts'

/** Houses and landmarks that touch one render chunk (drawn north to south by the painter). */
export type Structures = { houses: readonly House[]; landmarks: readonly Landmark[] }

/**
 * What the renderer reads of a town, by frame tile index. A single extract answers from one
 * `TownLayout`; a streamed world answers from the layout of the cell that owns the tile.
 */
export interface TownLookup {
  houseAt(i: number): House | undefined
  landmarkAt(i: number): Landmark | undefined
  hasTree(i: number): boolean
  hasFence(i: number): boolean
  hasGate(i: number): boolean
  /** Structures touching chunk (cx, cy) of `size` tiles; undefined when there are none. */
  structuresIn(cx: number, cy: number, size: number): Structures | undefined
}

/** Group structures by the chunks they touch. */
export function indexByChunk(houses: readonly House[], landmarks: readonly Landmark[], size: number, key: (cx: number, cy: number) => number, into = new Map<number, { houses: House[]; landmarks: Landmark[] }>()) {
  const add = (r: { x: number; y: number; w: number; h: number }, push: (e: { houses: House[]; landmarks: Landmark[] }) => void) => {
    for (let cy = Math.floor(r.y / size); cy <= Math.floor((r.y + r.h - 1) / size); cy++) {
      for (let cx = Math.floor(r.x / size); cx <= Math.floor((r.x + r.w - 1) / size); cx++) {
        const k = key(cx, cy)
        let e = into.get(k)
        if (!e) into.set(k, (e = { houses: [], landmarks: [] }))
        push(e)
      }
    }
  }
  for (const h of houses) add(h, (e) => e.houses.push(h))
  for (const l of landmarks) add(l, (e) => e.landmarks.push(l))
  return into
}

const chunkKeyOf = (cx: number, cy: number) => cy * (1 << 15) + cx

/** The lookup of one layout over its own grid (a single extract). */
export function layoutLookup(town: TownLayout): TownLookup {
  const bySize = new Map<number, Map<number, Structures>>()
  return {
    houseAt: (i) => {
      const k = town.houseAt[i] ?? -1
      return k >= 0 ? town.houses[k] : undefined
    },
    landmarkAt: (i) => {
      const k = town.landmarkAt[i] ?? -1
      return k >= 0 ? town.landmarks[k] : undefined
    },
    hasTree: (i) => town.trees.has(i),
    hasFence: (i) => town.fences.has(i),
    hasGate: (i) => town.gates.has(i),
    structuresIn(cx, cy, size) {
      let index = bySize.get(size)
      if (!index) bySize.set(size, (index = indexByChunk(town.houses, town.landmarks, size, chunkKeyOf)))
      return index.get(chunkKeyOf(cx, cy))
    },
  }
}
