import { Role, type RoleId } from '../sights/campus.ts'
import type { SightKind } from '../sights/types.ts'
import { TILE_PX } from '../tiles/grid.ts'
import { makeCanvas } from './env.ts'
import { P } from './palette.ts'
import { paintGardenTree } from './structures.ts'

/**
 * Tile art of the special buildings and campus grounds (landmarks spec, L11). Every kind has its own
 * material (roof pattern, wall, trim, outline), different from the house tiles, so a faculty, a hospital or a
 * church reads at a glance. Tiles tile: a roof or façade tile is drawn from its four neighbours (the bit mask
 * N=1, E=2, S=4, W=8 says which neighbour is part of the same building), so any footprint works. All colours
 * are our own picks; no logos, brands or real facades.
 */

export type Pattern = 'slabs' | 'flat' | 'brick' | 'slate' | 'domes' | 'tiers' | 'diamond'

export type CampusStyle = {
  pattern: Pattern
  roof: string
  roofB: string
  roofDark: string
  wall: string
  wallShade: string
  trim: string
  /** A band or stripe colour that marks the kind (teal stripes of the hospital, gold of the temple). */
  accent: string
  accent2: string
  glass: string
  outline: string
  paveA: string
  paveB: string
  /** Façade rhythm: how the windows are cut. */
  windows: 'square' | 'ribbon' | 'arched' | 'pointed' | 'columns'
}

const STONE: CampusStyle = { pattern: 'slabs', roof: '#cfc8b8', roofB: '#bdb5a2', roofDark: '#8c8574', wall: '#d8d0bc', wallShade: '#a39a86', trim: '#ebe5d6', accent: '#8d8470', accent2: '#ebe5d6', glass: '#5d93c9', outline: '#2b2740', paveA: '#e6dcc4', paveB: '#d6c9ab', windows: 'square' }

/** Materials per kind. Monuments have no area; they use plain stone if ever asked. */
export const CAMPUS_STYLE: Record<SightKind, CampusStyle> = {
  university: { pattern: 'slabs', roof: '#dcbb7b', roofB: '#cda868', roofDark: '#9c7a3e', wall: '#ecd49a', wallShade: '#b99a5e', trim: '#fff1c9', accent: '#2f4a82', accent2: '#ffd84a', glass: '#4b6fb5', outline: '#46341a', paveA: '#eadba8', paveB: '#dccb94', windows: 'columns' },
  hospital: { pattern: 'flat', roof: '#f4f7f9', roofB: '#dfe6eb', roofDark: '#9fb0ba', wall: '#fbfdfd', wallShade: '#c3ced6', trim: '#ffffff', accent: '#2fa59a', accent2: '#3fb56f', glass: '#79b8d8', outline: '#2d4a55', paveA: '#e5ecf0', paveB: '#d2dce3', windows: 'ribbon' },
  school: { pattern: 'brick', roof: '#b84c3a', roofB: '#a23f31', roofDark: '#6f261d', wall: '#cf6c52', wallShade: '#9e4632', trim: '#fbf7ec', accent: '#ffd84a', accent2: '#e8c9b0', glass: '#5d93c9', outline: '#43160f', paveA: '#e8cfba', paveB: '#d9bca3', windows: 'square' },
  church: { pattern: 'slate', roof: '#5f6b80', roofB: '#515c70', roofDark: '#2f3646', wall: '#e8e1cd', wallShade: '#b0a78e', trim: '#fbf7ec', accent: '#ffd84a', accent2: '#4b6fb5', glass: '#4b6fb5', outline: '#232030', paveA: '#e2dcd0', paveB: '#d0c8ba', windows: 'pointed' },
  mosque: { pattern: 'domes', roof: '#f3ecd8', roofB: '#e6dcbc', roofDark: '#b3a678', wall: '#f7f0dd', wallShade: '#cdc2a2', trim: '#e3b53c', accent: '#2fa59a', accent2: '#1d6f6a', glass: '#2a8f87', outline: '#103a38', paveA: '#f0e7cd', paveB: '#e1d5b2', windows: 'arched' },
  synagogue: { pattern: 'slate', roof: '#8497bd', roofB: '#7387ae', roofDark: '#46598a', wall: '#eaedf4', wallShade: '#a9b3c9', trim: '#ffd84a', accent: '#ffd84a', accent2: '#4b6fb5', glass: '#3f64b0', outline: '#1d2748', paveA: '#dfe3ed', paveB: '#cbd2e0', windows: 'arched' },
  temple: { pattern: 'tiers', roof: '#c2392b', roofB: '#a82d21', roofDark: '#6c1a13', wall: '#ecdcb4', wallShade: '#b99f6e', trim: '#ffd84a', accent: '#ffd84a', accent2: '#b52e22', glass: '#3a3d55', outline: '#33100b', paveA: '#ebd1aa', paveB: '#ddbd8d', windows: 'columns' },
  townHall: { pattern: 'diamond', roof: '#8d92a1', roofB: '#7b8090', roofDark: '#4d5163', wall: '#cdbf9a', wallShade: '#9c8f6c', trim: '#fbf7ec', accent: '#c8553d', accent2: '#4b6fb5', glass: '#5d93c9', outline: '#2a2540', paveA: '#ddd7c6', paveB: '#ccc4ae', windows: 'arched' },
  tower: STONE,
  arch: STONE,
  statue: STONE,
  fountain: STONE,
}

/** Warm window light of the night layer. */
export const CAMPUS_LIT = '#ffe27a'

type Ctx = CanvasRenderingContext2D
const rect = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c
  g.fillRect(x, y, w, h)
}

const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8
export const MASK = { N: NORTH, E: EAST, S: SOUTH, W: WEST } as const

/** Deterministic variant of a tile from its coordinates (no randomness: panning never shimmers). */
export const tileVariant = (gx: number, gy: number): number => {
  let h = Math.imul(gx, 2246822519) ^ Math.imul(gy, 3266489917)
  h = Math.imul(h ^ (h >>> 15), 2654435761)
  return (h ^ (h >>> 13)) >>> 0
}

/** The roof pattern of one 16 × 16 tile (before edges). */
function paintRoofPattern(g: Ctx, s: CampusStyle, mask: number): void {
  rect(g, 0, 0, 16, 16, s.roof)
  switch (s.pattern) {
    case 'slabs':
      for (let y = 0; y < 16; y += 4) {
        rect(g, 0, y + 3, 16, 1, s.roofDark)
        const off = (y >> 2) % 2 ? 4 : 12
        rect(g, off, y, 1, 3, s.roofDark)
        rect(g, (off + 8) % 16, y, 1, 3, s.roofDark)
        rect(g, 1, y, 6, 1, s.roofB)
      }
      break
    case 'flat':
      // A white roof with a teal band and a thin green line: unmistakable from far away.
      rect(g, 0, 11, 16, 1, s.roofB)
      rect(g, 0, 5, 16, 2, s.accent)
      rect(g, 0, 7, 16, 1, s.accent2)
      rect(g, 3, 1, 4, 3, s.roofB)
      rect(g, 4, 2, 2, 1, s.roofDark)
      rect(g, 10, 12, 4, 3, s.roofB)
      break
    case 'brick':
      for (let y = 0; y < 16; y += 4) {
        rect(g, 0, y + 3, 16, 1, s.roofDark)
        for (let x = (y >> 2) % 2 ? 2 : 6; x < 16; x += 8) rect(g, x, y, 1, 3, s.roofDark)
        rect(g, 0, y, 16, 1, s.roofB)
      }
      break
    case 'slate':
      for (let y = 0; y < 16; y += 3) {
        rect(g, 0, y + 2, 16, 1, s.roofDark)
        for (let x = (y / 3) % 2 ? 2 : 5; x < 16; x += 6) rect(g, x, y, 1, 2, s.roofB)
      }
      rect(g, 0, 7, 16, 2, s.roofDark)
      rect(g, 0, 7, 16, 1, s.roofB)
      break
    case 'tiers':
      for (let y = 0; y < 16; y += 4) {
        rect(g, 0, y, 16, 1, s.roofB)
        rect(g, 0, y + 3, 16, 1, s.roofDark)
        for (let x = 0; x < 16; x += 4) rect(g, x + ((y >> 2) % 2 ? 2 : 0), y + 1, 1, 2, s.roofDark)
      }
      rect(g, 0, 6, 16, 1, s.accent)
      rect(g, 0, 14, 16, 1, s.accent)
      break
    case 'diamond':
      for (let y = 0; y < 16; y += 4) {
        for (let x = 0; x < 16; x += 4) {
          rect(g, x + 1, y, 2, 1, s.roofB)
          rect(g, x, y + 1, 4, 2, s.roofB)
          rect(g, x + 1, y + 3, 2, 1, s.roofB)
        }
      }
      rect(g, 0, 15, 16, 1, s.roofDark)
      break
    case 'domes': {
      rect(g, 0, 0, 16, 16, s.roof)
      rect(g, 0, 15, 16, 1, s.roofB)
      if (mask === (NORTH | EAST | SOUTH | WEST)) {
        // A teal dome on an interior tile: a disc with its light on the upper left and a gold finial.
        const cx = 7.5
        const cy = 8.5
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const d = Math.hypot(x - cx, y - cy)
            if (d > 6.4) continue
            const lit = x + y < 14 && d < 4.2
            g.fillStyle = d > 5.4 ? s.accent2 : lit ? '#7fd8cf' : x + y > 16 ? s.accent2 : s.accent
            g.fillRect(x, y, 1, 1)
          }
        }
        rect(g, 7, 2, 2, 2, s.trim)
      }
      break
    }
  }
}

/** Roof detail bits: a ridge every fifth column, a parapet band every fourth row, a skylight on one tile in thirteen. */
export const RIDGE = 1
export const BAND = 2
export const SKYLIGHT = 4
export const roofDetail = (gx: number, gy: number): number => (gx % 5 === 0 ? RIDGE : 0) | (gy % 4 === 0 ? BAND : 0) | (tileVariant(gx, gy) % 13 === 0 ? SKYLIGHT : 0)

/** Breaks up a big roof so a campus building is not one flat colour: ridges, bands and skylights in the kind's trim. */
function paintRoofDetail(g: Ctx, s: CampusStyle, detail: number, lit: boolean): void {
  if (lit) {
    if (detail & SKYLIGHT) rect(g, 5, 5, 6, 6, CAMPUS_LIT)
    return
  }
  if (detail & RIDGE) {
    rect(g, 7, 0, 2, 16, s.roofDark)
    rect(g, 7, 0, 1, 16, s.roofB)
  }
  if (detail & BAND) {
    rect(g, 0, 7, 16, 2, s.trim)
    rect(g, 0, 9, 16, 1, s.roofDark)
  }
  if (detail & SKYLIGHT) {
    rect(g, 4, 4, 8, 8, s.trim)
    rect(g, 5, 5, 6, 6, s.glass)
    rect(g, 5, 5, 6, 1, s.windows === 'ribbon' ? s.wallShade : s.accent)
    rect(g, 7, 5, 1, 6, s.trim)
    rect(g, 4, 12, 8, 1, s.roofDark)
  }
}

/** Dark outline on the sides that touch no building, with a light eave on the north and west insides. */
function paintEdges(g: Ctx, s: CampusStyle, mask: number): void {
  if (!(mask & NORTH)) {
    rect(g, 0, 1, 16, 1, s.roofB)
    rect(g, 0, 0, 16, 1, s.outline)
  }
  if (!(mask & WEST)) {
    rect(g, 1, 0, 1, 16, s.roofB)
    rect(g, 0, 0, 1, 16, s.outline)
  }
  if (!(mask & EAST)) {
    rect(g, 14, 0, 1, 16, s.roofDark)
    rect(g, 15, 0, 1, 16, s.outline)
  }
  if (!(mask & SOUTH)) rect(g, 0, 15, 16, 1, s.outline)
}

/** The window rectangles of a façade tile, `[x, y, w, h]` (glass), by rhythm and variant. */
export function windowRects(s: CampusStyle, variant: number): [number, number, number, number][] {
  switch (s.windows) {
    case 'ribbon':
      return [[1, 4, 14, 3], [1, 9, 14, 3]]
    case 'arched':
      return [[3, 4, 3, 8], [10, 4, 3, 8]]
    case 'pointed':
      return variant % 3 === 0 ? [[7, 3, 2, 9]] : [[4, 4, 2, 8], [10, 4, 2, 8]]
    case 'columns':
      return [[4, 4, 3, 7], [9, 4, 3, 7]]
    default:
      return [[2, 4, 4, 5], [10, 4, 4, 5]]
  }
}

function paintWindowsOn(g: Ctx, s: CampusStyle, variant: number, colour: string, glassOnly: boolean): void {
  for (const [x, y, w, h] of windowRects(s, variant)) {
    if (!glassOnly) rect(g, x - 1, y - 1, w + 2, h + 2, s.windows === 'ribbon' ? s.wallShade : s.trim)
    rect(g, x, y, w, h, colour)
    if (s.windows === 'arched' || s.windows === 'pointed') {
      // Round or pointed head: cut the top corners back to the wall.
      if (!glassOnly) {
        rect(g, x - 1, y - 1, 1, 1, s.wall)
        rect(g, x + w, y - 1, 1, 1, s.wall)
      }
    }
    if (!glassOnly && s.windows !== 'ribbon') rect(g, x, y + h, w, 1, s.wallShade)
  }
}

/** A façade tile: wall with the kind's windows, a base line, outlines where no building continues. */
function paintWall(g: Ctx, s: CampusStyle, mask: number, variant: number, lit: boolean): void {
  if (lit) {
    paintWindowsOn(g, s, variant, CAMPUS_LIT, true)
    return
  }
  rect(g, 0, 0, 16, 16, s.wall)
  // Light on the upper edge, shade on the lower part: the wall below a roof.
  rect(g, 0, 0, 16, 2, s.wallShade)
  rect(g, 0, 2, 16, 1, s.trim)
  if (s.windows === 'ribbon') {
    rect(g, 0, 13, 16, 2, s.accent)
    rect(g, 0, 15, 16, 1, s.accent2)
  }
  if (s.pattern === 'brick') {
    for (let y = 3; y < 15; y += 3) {
      rect(g, 0, y, 16, 1, s.wallShade)
      for (let x = (y / 3) % 2 ? 2 : 6; x < 16; x += 8) rect(g, x, y - 2, 1, 2, s.wallShade)
    }
  }
  if (s.windows === 'columns') {
    // Columns (university) or red pillars with gold capitals (temple) on the edges and between the windows.
    for (const x of [0, 7, 14]) {
      rect(g, x, 3, 2, 12, s.pattern === 'tiers' ? s.accent2 : s.trim)
      rect(g, x + 1, 3, 1, 12, s.pattern === 'tiers' ? s.roofDark : s.wallShade)
      rect(g, x, 3, 2, 1, s.accent2 === '#b52e22' ? s.trim : s.accent2)
    }
  }
  if (variant % 5 === 0 && s.windows !== 'ribbon') {
    // A door in place of the windows on one façade tile in five.
    rect(g, 5, 6, 6, 9, s.trim)
    rect(g, 6, 7, 4, 8, '#5a381e')
    rect(g, 8, 7, 1, 8, '#3d2713')
    rect(g, 5, 5, 6, 1, s.accent)
  } else paintWindowsOn(g, s, variant, s.glass, false)
  if (s.pattern === 'tiers' || s.pattern === 'domes') rect(g, 0, 3, 16, 1, s.accent)
  if (s.pattern === 'diamond') rect(g, 0, 3, 16, 1, s.accent)
  // The base, then the outline on the sides with no neighbour.
  rect(g, 0, 14, 16, 1, s.wallShade)
  rect(g, 0, 15, 16, 1, s.outline)
  if (!(mask & WEST)) rect(g, 0, 0, 1, 16, s.outline)
  if (!(mask & EAST)) rect(g, 15, 0, 1, 16, s.outline)
}

function paintLawn(g: Ctx, gx: number, gy: number): void {
  // Mown stripes two tiles wide, a few tufts: reads as kept grass, not as the wild park tile.
  rect(g, 0, 0, 16, 16, (gx >> 1) % 2 === 0 ? P.lawnA : P.lawnB)
  const v = tileVariant(gx, gy)
  for (let k = 0; k < 3; k++) rect(g, (v >> (k * 5)) & 15, (v >> (k * 3 + 1)) % 16, 1, 1, P.lawnDot)
}

function paintPaving(g: Ctx, s: CampusStyle, gx: number, gy: number): void {
  rect(g, 0, 0, 16, 16, s.paveA)
  rect(g, 0, 7, 16, 1, s.paveB)
  rect(g, 0, 15, 16, 1, s.paveB)
  rect(g, (gy % 2 ? 3 : 11) % 16, 0, 1, 7, s.paveB)
  rect(g, (gy % 2 ? 11 : 3) % 16, 8, 1, 7, s.paveB)
  if (tileVariant(gx, gy) % 9 === 0) rect(g, 6, 5, 4, 4, s.accent === '#ffd84a' ? s.accent2 : s.accent)
}

const tiles = new Map<string, HTMLCanvasElement>()

/**
 * The 16 × 16 bitmap of a tile role for a kind. `mask` (N, E, S, W neighbours of the same building) matters for
 * roofs and façades; `variant` and (gx, gy) for lawn, paving, trees and doors. `lit` is the night layer: only the
 * window glass, in warm light, on façade tiles. Undefined when there is nothing to draw.
 */
export function campusTile(kind: SightKind, role: RoleId, mask: number, gx: number, gy: number, lit = false): HTMLCanvasElement | undefined {
  if (lit && role !== Role.wall && !(role === Role.roof && roofDetail(gx, gy) & SKYLIGHT)) return undefined
  const s = CAMPUS_STYLE[kind]
  const variant = tileVariant(gx, gy)
  // What the tile depends on: grass, paving and trees on parity and variant, façades on variant.
  const detail = role === Role.roof ? roofDetail(gx, gy) : role === Role.wall ? variant % 15 : role === Role.lawn ? ((gx >> 1) % 2) + 2 * (variant % 7) : role === Role.paving ? (gy % 2) + 2 * (variant % 9 === 0 ? 1 : 0) : role === Role.tree ? variant % 4 : 0
  const key = `${kind}|${role}|${role === Role.roof || role === Role.wall ? mask : 0}|${detail}|${lit ? 1 : 0}`
  const found = tiles.get(key)
  if (found) return found
  const c = makeCanvas(TILE_PX, TILE_PX)
  const g = c.getContext('2d')
  if (!g) return undefined
  g.imageSmoothingEnabled = false
  switch (role) {
    case Role.roof:
      if (lit) {
        paintRoofDetail(g, s, detail, true)
        break
      }
      paintRoofPattern(g, s, mask)
      paintRoofDetail(g, s, detail, false)
      paintEdges(g, s, mask)
      break
    case Role.wall:
      paintWall(g, s, mask, variant, lit)
      break
    case Role.lawn:
      paintLawn(g, gx, gy)
      break
    case Role.paving:
      paintPaving(g, s, gx, gy)
      break
    case Role.tree:
      paintLawn(g, gx, gy)
      paintGardenTree(g, 0, 0, variant)
      break
    default:
      return undefined
  }
  tiles.set(key, c)
  return c
}

/** Soft warm halo, 32 × 32, drawn scaled with `lighter` around a building at night. Built once. */
let halo: HTMLCanvasElement | undefined
export function haloSprite(): HTMLCanvasElement {
  if (halo) return halo
  const c = makeCanvas(32, 32)
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#ffa23c'
    for (const [r, a] of [[16, 0.07], [13, 0.08], [10, 0.1], [7, 0.12]] as const) {
      g.globalAlpha = a
      g.beginPath()
      g.arc(16, 16, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  halo = c
  return c
}
