import type { LandmarkKind } from '../osm/types.ts'

/** Shared shapes and constants of the town layout. See `layout.ts` for the entry point. */

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
  /** Special buildings first (in a fixed kind order), then park gates. */
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

export const LOT = { minW: 4, maxW: 7, minH: 4, maxH: 6 } as const
export const ROOF_COLOURS = 6
export const WALL_COLOURS = 4
