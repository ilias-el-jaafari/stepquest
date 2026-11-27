import { Feat, Role, VARIANT_TRAITS, type Prop, type RoleId, type RoofKind } from '../sights/campus.ts'
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

export type Pattern = 'slabs' | 'flat' | 'brick' | 'slate' | 'domes' | 'tiers' | 'diamond' | 'tiles' | 'copper' | 'plain' | 'deck'

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
  townHall: { pattern: 'diamond', roof: '#5b82c8', roofB: '#4d70b4', roofDark: '#2f4a82', wall: '#e8dcb6', wallShade: '#9c8f6c', trim: '#fbf7ec', accent: '#c8553d', accent2: '#4b6fb5', glass: '#5d93c9', outline: '#2a2540', paveA: '#ddd7c6', paveB: '#ccc4ae', windows: 'arched' },
  tower: STONE,
  arch: STONE,
  statue: STONE,
  fountain: STONE,
}

/** Outline thickness of special buildings (L13.1). */
export const OUTLINE_PX = 2

export type VariantStyle = CampusStyle & { roofKind: RoofKind }

/**
 * Variants per kind (L12.1): patches over the kind's style. The first is the kind's own look. The lists have
 * the length of `VARIANT_TRAITS` (roof kind, chimneys, cupolas live there, next to the placement).
 */
export const VARIANTS: Record<SightKind, Partial<CampusStyle>[]> = {
  university: [
    {},
    { pattern: 'tiles', roof: '#c8553d', roofB: '#b04632', roofDark: '#7a2c1f', wall: '#f1dcb0', wallShade: '#c9a874' },
    { pattern: 'plain', roof: '#e9edf0', roofB: '#d3dae0', roofDark: '#97a5b0', wall: '#c9d6df', wallShade: '#8fa3b3', trim: '#ffffff', glass: '#79b8d8', windows: 'ribbon' },
    { pattern: 'slate', roof: '#6b7a93', roofB: '#5a6882', roofDark: '#3a455c', wall: '#e3d0a4', wallShade: '#b09a68' },
    { pattern: 'copper', roof: '#5fae8f', roofB: '#4c9a7b', roofDark: '#2f6e58', wall: '#efe0b8', wallShade: '#bba878' },
    { pattern: 'deck', roof: '#c9a46a', roofB: '#b58f55', roofDark: '#8a6a38', wall: '#f0c28a', wallShade: '#c0905a', windows: 'square' },
  ],
  school: [
    {},
    { pattern: 'tiles', roof: '#e08a3a', roofB: '#c97428', roofDark: '#8e4d14', wall: '#f2c879', wallShade: '#c49a45' },
    { pattern: 'plain', roof: '#f1f1ea', roofB: '#dcdcd2', roofDark: '#9a9a8c', wall: '#9fc4d8', wallShade: '#6f97ae' },
    { pattern: 'deck', roof: '#c98b5a', roofB: '#b4764a', roofDark: '#7e4f2a', wall: '#d9a07a', wallShade: '#a9744e' },
  ],
  hospital: [
    {},
    { pattern: 'plain', roof: '#e8f1f5', roofB: '#d3e2ea', roofDark: '#9bb3c0', wall: '#e3f1f0', wallShade: '#b4cfcd' },
    { pattern: 'copper', roof: '#8fcfb0', roofB: '#79bd9d', roofDark: '#4d8f72', wall: '#f6fbfa', wallShade: '#c7d9d5' },
    { pattern: 'deck', roof: '#d8c9a4', roofB: '#c4b389', roofDark: '#9a8a62', wall: '#eef6f8', wallShade: '#bccbd2' },
  ],
  church: [{}, { pattern: 'tiles', roof: '#b5533c', roofB: '#9d4331', roofDark: '#6a2a1e', wall: '#efe6cc' }, { pattern: 'copper', roof: '#4fa58a', roofB: '#3f917a', roofDark: '#276250', wall: '#e3dcc4' }],
  mosque: [{}, { accent: '#e3b53c', accent2: '#a07c18', roof: '#efe3c3', wall: '#f3ead0' }, { accent: '#4b6fb5', accent2: '#2f4a82', roof: '#eef0f2', wall: '#f2f3f4' }],
  synagogue: [{}, { pattern: 'tiles', roof: '#b7684a', roofB: '#a25a3f', roofDark: '#6c3624', wall: '#e8edf5' }, { pattern: 'copper', roof: '#6aa6b8', roofB: '#5792a4', roofDark: '#376878', wall: '#e6ecef' }],
  temple: [{}, { roof: '#2f8f6a', roofB: '#26795a', roofDark: '#154a36', accent2: '#2f7a58' }, { roof: '#d9a62a', roofB: '#bf8d18', roofDark: '#8a5f08', wall: '#f3e3c0' }],
  townHall: [{}, { pattern: 'tiles', roof: '#c8553d', roofB: '#b04632', roofDark: '#7a2c1f', wall: '#efe0b6' }, { pattern: 'copper', roof: '#4fae94', roofB: '#3e9a82', roofDark: '#25664f', wall: '#e8dcb6' }],
  tower: [{}],
  arch: [{}],
  statue: [{}],
  fountain: [{}],
}

const styles = new Map<string, VariantStyle>()
/** The style of one variant of a kind (the index wraps). */
export function styleFor(kind: SightKind, variant: number): VariantStyle {
  const list = VARIANTS[kind]
  const i = ((variant % list.length) + list.length) % list.length
  const key = `${kind}|${i}`
  let st = styles.get(key)
  if (!st) {
    st = { ...CAMPUS_STYLE[kind], ...list[i], roofKind: VARIANT_TRAITS[kind][i]?.roofKind ?? 'pitched' }
    styles.set(key, st)
  }
  return st
}

/** Warm window light of the night layer. */
export const CAMPUS_LIT = '#ffe27a'
const DOOR_WOOD = '#6b4426'
const DOOR_DARK = '#3d2713'

type Ctx = CanvasRenderingContext2D
const rect = (g: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c
  g.fillRect(x, y, w, h)
}
const veil = (g: Ctx, x: number, y: number, w: number, h: number, c: string, a: number) => {
  g.globalAlpha = a
  rect(g, x, y, w, h, c)
  g.globalAlpha = 1
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

/** Run `draw` rotated so that "south" (the tile's bottom edge) points to `side` (quarter turns about the tile centre keep pixels crisp). */
function facing(g: Ctx, side: 'N' | 'E' | 'S' | 'W', draw: () => void): void {
  if (side === 'S') {
    draw()
    return
  }
  g.save()
  g.translate(8, 8)
  g.rotate(side === 'E' ? -Math.PI / 2 : side === 'W' ? Math.PI / 2 : Math.PI)
  g.translate(-8, -8)
  draw()
  g.restore()
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
    case 'tiles':
      // Clay tiles: rows with a dark lower edge and staggered joints.
      for (let y = 0; y < 16; y += 4) {
        rect(g, 0, y, 16, 1, s.roofB)
        rect(g, 0, y + 3, 16, 1, s.roofDark)
        for (let x = (y >> 2) % 2 ? 2 : 0; x < 16; x += 4) rect(g, x, y + 1, 1, 2, s.roofDark)
      }
      break
    case 'copper':
      // Standing seams.
      for (let x = 0; x < 16; x += 4) {
        rect(g, x, 0, 1, 16, s.roofDark)
        rect(g, x + 1, 0, 1, 16, s.roofB)
      }
      break
    case 'plain':
      rect(g, 0, 7, 16, 1, s.roofB)
      rect(g, 7, 0, 1, 16, s.roofB)
      rect(g, 0, 8, 16, 1, s.roofDark)
      break
    case 'deck':
      for (let y = 0; y < 16; y += 3) {
        rect(g, 0, y + 2, 16, 1, s.roofDark)
        rect(g, ((y * 5) % 11) + 2, y, 1, 2, s.roofB)
      }
      break
    case 'domes': {
      rect(g, 0, 15, 16, 1, s.roofB)
      if (mask === (NORTH | EAST | SOUTH | WEST)) {
        // A dome on an interior tile: a disc with its light on the upper left and a gold finial.
        const cx = 7.5
        const cy = 8.5
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const d = Math.hypot(x - cx, y - cy)
            if (d > 6.4) continue
            const lit = x + y < 14 && d < 4.2
            g.fillStyle = d > 5.4 ? s.accent2 : lit ? '#a8ece4' : x + y > 16 ? s.accent2 : s.accent
            g.fillRect(x, y, 1, 1)
          }
        }
        rect(g, 7, 2, 2, 2, s.trim)
      }
      break
    }
  }
}

/** Roof slopes and ridge (pitched), skylight (flat) or planter (terrace): the shape of the roof (L13.1). */
function paintRoofFeature(g: Ctx, s: VariantStyle, f: number, lit: boolean): void {
  if (lit) {
    if (f === Feat.skylight) rect(g, 5, 5, 6, 6, CAMPUS_LIT)
    return
  }
  switch (f) {
    case Feat.slopeA:
      veil(g, 0, 0, 16, 16, '#ffffff', 0.2)
      break
    case Feat.slopeB:
      veil(g, 0, 0, 16, 16, '#000000', 0.2)
      break
    case Feat.ridge:
      veil(g, 0, 0, 16, 16, '#000000', 0.06)
      rect(g, 0, 6, 16, 4, s.roofDark)
      rect(g, 0, 5, 16, 1, s.trim)
      rect(g, 0, 6, 16, 1, s.roofB)
      rect(g, 0, 10, 16, 1, s.outline)
      break
    case Feat.skylight:
      rect(g, 4, 4, 8, 8, s.trim)
      rect(g, 5, 5, 6, 6, s.glass)
      rect(g, 5, 5, 6, 1, s.accent)
      rect(g, 7, 5, 1, 6, s.trim)
      rect(g, 4, 12, 8, 1, s.roofDark)
      break
    case Feat.planter:
      rect(g, 3, 3, 10, 8, s.roofDark)
      rect(g, 4, 4, 8, 6, '#4f8a43')
      rect(g, 5, 5, 2, 2, '#8fcf6a')
      rect(g, 9, 6, 2, 2, '#8fcf6a')
      rect(g, 3, 11, 10, 1, s.outline)
      break
  }
}

/** Dark outline on the sides that touch no building (2 px), with a light eave on the north and west insides. */
function paintEdges(g: Ctx, s: VariantStyle, mask: number): void {
  const flat = s.roofKind !== 'pitched'
  if (!(mask & NORTH)) {
    rect(g, 0, OUTLINE_PX, 16, 1, flat ? s.trim : s.roofB)
    rect(g, 0, 0, 16, OUTLINE_PX, s.outline)
  }
  if (!(mask & WEST)) {
    rect(g, OUTLINE_PX, 0, 1, 16, flat ? s.trim : s.roofB)
    rect(g, 0, 0, OUTLINE_PX, 16, s.outline)
  }
  if (!(mask & EAST)) {
    rect(g, 16 - OUTLINE_PX - 1, 0, 1, 16, flat ? s.trim : s.roofDark)
    rect(g, 16 - OUTLINE_PX, 0, OUTLINE_PX, 16, s.outline)
  }
  if (!(mask & SOUTH)) rect(g, 0, 16 - OUTLINE_PX, 16, OUTLINE_PX, s.outline)
}

/** The window rectangles of a façade tile, `[x, y, w, h]` (glass), by rhythm, variant and storeys. */
export function windowRects(s: CampusStyle, variant: number, storeys = 1): [number, number, number, number][] {
  const two = storeys > 1
  switch (s.windows) {
    case 'ribbon':
      return [[1, 4, 14, 3], [1, 9, 14, 3]]
    case 'arched':
      return two ? [[3, 3, 3, 4], [10, 3, 3, 4], [3, 8, 3, 4], [10, 8, 3, 4]] : [[3, 4, 3, 8], [10, 4, 3, 8]]
    case 'pointed':
      return variant % 3 === 0 && !two ? [[7, 3, 2, 9]] : two ? [[4, 3, 2, 4], [10, 3, 2, 4], [4, 8, 2, 4], [10, 8, 2, 4]] : [[4, 4, 2, 8], [10, 4, 2, 8]]
    case 'columns':
      return two ? [[4, 3, 3, 3], [9, 3, 3, 3], [4, 8, 3, 3], [9, 8, 3, 3]] : [[4, 4, 3, 7], [9, 4, 3, 7]]
    default:
      return two ? [[2, 3, 4, 3], [10, 3, 4, 3], [2, 8, 4, 3], [10, 8, 4, 3]] : [[2, 4, 4, 5], [10, 4, 4, 5]]
  }
}

function paintWindowsOn(g: Ctx, s: CampusStyle, variant: number, storeys: number, colour: string, glassOnly: boolean): void {
  for (const [x, y, w, h] of windowRects(s, variant, storeys)) {
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

/** Double doors on a façade tile: the kind decides the shape (arched, red lacquer, glass under a canopy, plain). */
function paintDoor(g: Ctx, kind: SightKind, s: VariantStyle, lit: boolean): void {
  if (kind === 'hospital') {
    // A canopy slab over glass sliding doors.
    if (lit) {
      rect(g, 4, 7, 8, 8, CAMPUS_LIT)
      return
    }
    rect(g, 0, 2, 16, 3, s.accent)
    rect(g, 0, 5, 16, 1, s.accent2)
    rect(g, 0, 6, 16, 1, s.wallShade)
    rect(g, 3, 7, 10, 8, s.trim)
    rect(g, 4, 7, 8, 8, s.glass)
    rect(g, 7, 7, 2, 8, s.wallShade)
    rect(g, 4, 7, 8, 1, '#ffffff')
    return
  }
  if (lit) {
    rect(g, 5, 3, 6, 2, CAMPUS_LIT)
    if (kind === 'townHall' || kind === 'university') rect(g, 6, 6, 4, 2, CAMPUS_LIT)
    return
  }
  const arched = kind === 'mosque' || kind === 'synagogue' || kind === 'townHall' || kind === 'church'
  const leaf = kind === 'temple' ? '#b52e22' : DOOR_WOOD
  rect(g, 3, arched ? 4 : 5, 10, arched ? 11 : 10, s.trim)
  if (arched) {
    rect(g, 3, 4, 1, 1, s.wall)
    rect(g, 12, 4, 1, 1, s.wall)
    rect(g, 5, 3, 6, 1, s.trim)
  }
  rect(g, 4, arched ? 6 : 6, 4, 9, leaf)
  rect(g, 8, arched ? 6 : 6, 4, 9, leaf)
  rect(g, 7, 6, 2, 9, DOOR_DARK)
  rect(g, 5, 8, 2, 3, DOOR_DARK)
  rect(g, 9, 8, 2, 3, DOOR_DARK)
  rect(g, 6, 11, 1, 1, '#ffd84a')
  rect(g, 9, 11, 1, 1, '#ffd84a')
  if (kind === 'school') rect(g, 3, 3, 10, 1, s.accent)
}

/** A façade tile: wall with the kind's windows, a base line, outlines where no building continues. */
function paintWall(g: Ctx, kind: SightKind, s: VariantStyle, mask: number, variant: number, f: number, storeys: number, lit: boolean): void {
  if (lit) {
    if (f === Feat.door) paintDoor(g, kind, s, true)
    else if (f === Feat.portico) {
      rect(g, 4, 4, 3, 7, CAMPUS_LIT)
      rect(g, 9, 4, 3, 7, CAMPUS_LIT)
    } else paintWindowsOn(g, s, variant, storeys, CAMPUS_LIT, true)
    return
  }
  rect(g, 0, 0, 16, 16, s.wall)
  // Shade under the eave, light line, then the wall.
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
  if (f === Feat.door) {
    paintDoor(g, kind, s, false)
  } else if (f === Feat.portico) {
    // Columns with capitals and bases and windows between them.
    rect(g, 4, 4, 8, 10, s.wallShade)
    rect(g, 5, 5, 6, 8, s.glass)
    rect(g, 7, 5, 2, 8, s.trim)
    for (const x of [0, 13]) {
      rect(g, x, 3, 3, 1, s.trim)
      rect(g, x, 4, 3, 10, s.trim)
      rect(g, x + 2, 4, 1, 10, s.wallShade)
      rect(g, x - (x ? 1 : 0), 14, 4, 1, s.trim)
    }
  } else {
    if (s.windows === 'columns') {
      for (const x of [0, 7, 14]) {
        rect(g, x, 3, 2, 12, s.pattern === 'tiers' ? s.accent2 : s.trim)
        rect(g, x + 1, 3, 1, 12, s.pattern === 'tiers' ? s.roofDark : s.wallShade)
        rect(g, x, 3, 2, 1, s.accent2 === '#b52e22' ? s.trim : s.accent2)
      }
    }
    paintWindowsOn(g, s, variant, storeys, s.glass, false)
  }
  if (s.pattern === 'tiers' || s.pattern === 'domes' || s.pattern === 'diamond') rect(g, 0, 3, 16, 1, s.accent)
  // The base, then the outline on the sides with no neighbour.
  rect(g, 0, 14 - (OUTLINE_PX - 1), 16, 1, s.wallShade)
  rect(g, 0, 16 - OUTLINE_PX, 16, OUTLINE_PX, s.outline)
  if (!(mask & WEST)) rect(g, 0, 0, OUTLINE_PX, 16, s.outline)
  if (!(mask & EAST)) rect(g, 16 - OUTLINE_PX, 0, OUTLINE_PX, 16, s.outline)
}

/** Features that sit on a roof tile of the main building's front: pediment, rose window, balcony. */
function paintFront(g: Ctx, kind: SightKind, s: VariantStyle, mask: number, f: number, lit: boolean): void {
  if (f === Feat.rose) {
    if (lit) {
      g.fillStyle = CAMPUS_LIT
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot(x - 7.5, y - 8) < 3.6) g.fillRect(x, y, 1, 1)
      return
    }
    rect(g, 0, 0, 16, 16, s.wall)
    rect(g, 0, 0, 16, 2, s.wallShade)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 8)
        if (d > 6.2) continue
        g.fillStyle = d > 5.2 ? s.outline : d > 4.2 ? s.trim : s.glass
        g.fillRect(x, y, 1, 1)
      }
    }
    rect(g, 7, 4, 2, 9, s.trim)
    rect(g, 3, 7, 10, 2, s.trim)
    return
  }
  if (f === Feat.pediment) {
    if (lit) return
    rect(g, 0, 0, 16, 16, s.roof)
    for (let y = 2; y < 16; y++) {
      const half = Math.min(8, Math.round((y - 1) * 0.75))
      rect(g, 8 - half, y, half * 2, 1, y === 15 ? s.wallShade : s.trim)
      rect(g, 8 - half, y, 1, 1, s.outline)
      rect(g, 7 + half, y, 1, 1, s.outline)
    }
    rect(g, 7, 7, 2, 3, s.accent2)
    rect(g, 0, 15, 16, 1, s.outline)
    return
  }
  if (f === Feat.balcony) {
    if (lit) {
      rect(g, 3, 3, 3, 6, CAMPUS_LIT)
      rect(g, 10, 3, 3, 6, CAMPUS_LIT)
      return
    }
    rect(g, 0, 0, 16, 16, s.wall)
    rect(g, 0, 0, 16, 2, s.wallShade)
    rect(g, 2, 3, 5, 7, s.trim)
    rect(g, 3, 3, 3, 6, s.glass)
    rect(g, 9, 3, 5, 7, s.trim)
    rect(g, 10, 3, 3, 6, s.glass)
    rect(g, 0, 10, 16, 1, s.trim)
    for (let x = 1; x < 16; x += 3) rect(g, x, 11, 1, 4, s.trim)
    rect(g, 0, 14, 16, 2, s.accent)
    void mask
    void kind
  }
}

/** A side entrance: a small porch on the outer edge of a roof tile (the entrance faces east, west or north). */
function paintCanopy(g: Ctx, s: VariantStyle, side: 'N' | 'E' | 'W', lit: boolean): void {
  facing(g, side, () => {
    if (lit) {
      rect(g, 5, 9, 6, 2, CAMPUS_LIT)
      return
    }
    rect(g, 2, 5, 12, 10, s.trim)
    rect(g, 2, 5, 12, 1, s.accent)
    rect(g, 4, 7, 8, 8, s.wallShade)
    rect(g, 5, 8, 3, 7, DOOR_WOOD)
    rect(g, 8, 8, 3, 7, DOOR_WOOD)
    rect(g, 7, 8, 2, 7, DOOR_DARK)
    rect(g, 2, 14, 12, 2, s.outline)
  })
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

/** Steps leading down from a door (south version, rotated for the other sides): stone treads with cheek walls. */
function paintSteps(g: Ctx, s: CampusStyle, side: 'N' | 'E' | 'S' | 'W'): void {
  rect(g, 0, 0, 16, 16, s.paveA)
  facing(g, side, () => {
    rect(g, 1, 0, 14, 16, s.trim)
    for (let y = 3; y < 16; y += 4) {
      rect(g, 1, y, 14, 1, s.wallShade)
      rect(g, 1, y + 1, 14, 1, s.paveB)
    }
    rect(g, 0, 0, 2, 16, s.wallShade)
    rect(g, 14, 0, 2, 16, s.wallShade)
    rect(g, 0, 0, 1, 16, s.outline)
    rect(g, 15, 0, 1, 16, s.outline)
  })
}

/** Plaza extras: the ambulance bay stripes, a school fence, a temple gate. */
function paintPlazaFeature(g: Ctx, s: CampusStyle, f: number): void {
  switch (f) {
    case Feat.bay:
      for (let y = 1; y < 16; y += 5) {
        rect(g, 0, y, 16, 2, s.accent2)
        rect(g, 0, y + 2, 16, 1, s.accent)
      }
      break
    case Feat.fence:
    case Feat.fenceN:
    case Feat.fenceE:
    case Feat.fenceW:
      facing(g, f === Feat.fence ? 'S' : f === Feat.fenceN ? 'N' : f === Feat.fenceE ? 'E' : 'W', () => {
        rect(g, 0, 13, 16, 1, s.outline)
        rect(g, 0, 10, 16, 1, s.outline)
        for (let x = 0; x < 16; x += 4) rect(g, x, 9, 2, 6, s.accent === '#ffd84a' ? '#f3e7c8' : s.trim)
        for (let x = 0; x < 16; x += 4) rect(g, x, 9, 2, 1, s.outline)
      })
      break
    case Feat.gate:
    case Feat.gateV:
      facing(g, f === Feat.gate ? 'S' : 'E', () => {
        // Two red posts under a gold-edged double lintel.
        for (const x of [1, 12]) {
          rect(g, x, 4, 3, 12, '#b52e22')
          rect(g, x + 2, 4, 1, 12, '#6c1a13')
          rect(g, x - 1, 14, 5, 2, s.outline)
        }
        rect(g, 0, 2, 16, 3, '#c2392b')
        rect(g, 0, 2, 16, 1, '#ffd84a')
        rect(g, 0, 5, 16, 1, '#6c1a13')
        rect(g, 2, 7, 12, 2, '#c2392b')
      })
      break
  }
}

/** A court tile: kept lawn with a small hedge edge, or the cross path. */
function paintCourt(g: Ctx, s: CampusStyle, gx: number, gy: number, path: boolean): void {
  if (path) {
    paintPaving(g, s, gx, gy)
    return
  }
  paintLawn(g, gx, gy)
  if (tileVariant(gx, gy) % 5 === 0) paintGardenTree(g, 0, 0, tileVariant(gx, gy))
}

const tiles = new Map<string, HTMLCanvasElement>()

/**
 * The 16 × 16 bitmap of a tile role for a variant of a kind. `mask` (N, E, S, W neighbours of the same building)
 * matters for roofs and façades; `feat` (door, columns, slopes, steps …) for the tiles that carry one; (gx, gy)
 * for lawn, paving, trees. `lit` is the night layer: warm window glass, doorways and skylights. Undefined when
 * there is nothing to draw.
 */
export function campusTile(kind: SightKind, variant: number, role: RoleId, mask: number, feat: number, gx: number, gy: number, storeys = 1, lit = false): HTMLCanvasElement | undefined {
  const isBuilding = role === Role.roof || role === Role.wall
  if (lit && role !== Role.wall) {
    const litRoof = feat === Feat.skylight || feat === Feat.rose || feat === Feat.balcony || feat === Feat.canopyN || feat === Feat.canopyE || feat === Feat.canopyW
    if (role !== Role.roof || !litRoof) return undefined
  }
  const s = styleFor(kind, variant)
  const tv = tileVariant(gx, gy)
  // What the tile depends on: grass, paving and trees on parity and variant, façades on variant.
  const detail = role === Role.wall ? tv % 15 : role === Role.lawn ? ((gx >> 1) % 2) + 2 * (tv % 7) : role === Role.paving ? (gy % 2) + 2 * (tv % 9 === 0 ? 1 : 0) : role === Role.tree ? tv % 4 : role === Role.court ? (tv % 5 === 0 ? 1 : 0) + 2 * ((gx >> 1) % 2) : 0
  const key = `${kind}|${((variant % VARIANTS[kind].length) + VARIANTS[kind].length) % VARIANTS[kind].length}|${role}|${isBuilding ? mask : 0}|${feat}|${detail}|${role === Role.wall ? storeys : 0}|${lit ? 1 : 0}`
  const found = tiles.get(key)
  if (found) return found
  const c = makeCanvas(TILE_PX, TILE_PX)
  const g = c.getContext('2d')
  if (!g) return undefined
  g.imageSmoothingEnabled = false
  const canopySide = feat === Feat.canopyN ? 'N' : feat === Feat.canopyE ? 'E' : feat === Feat.canopyW ? 'W' : undefined
  switch (role) {
    case Role.roof:
      if (feat === Feat.rose || feat === Feat.pediment || feat === Feat.balcony) {
        paintFront(g, kind, s, mask, feat, lit)
        if (!lit) paintEdges(g, s, mask & ~SOUTH & ~NORTH)
        break
      }
      if (lit) {
        if (canopySide) paintCanopy(g, s, canopySide, true)
        else paintRoofFeature(g, s, feat, true)
        break
      }
      paintRoofPattern(g, s, mask)
      if (s.roofKind === 'pitched' && s.pattern !== 'domes') paintRoofFeature(g, s, feat, false)
      else if (s.roofKind !== 'pitched') paintRoofFeature(g, s, feat === Feat.skylight || feat === Feat.planter ? feat : 0, false)
      paintEdges(g, s, mask)
      if (canopySide) paintCanopy(g, s, canopySide, false)
      break
    case Role.wall:
      paintWall(g, kind, s, mask, tv, feat, storeys, lit)
      break
    case Role.lawn:
      paintLawn(g, gx, gy)
      break
    case Role.paving:
      paintPaving(g, s, gx, gy)
      paintPlazaFeature(g, s, feat)
      break
    case Role.court:
      paintCourt(g, s, gx, gy, feat === Feat.courtPath)
      break
    case Role.steps:
      paintSteps(g, s, feat === Feat.stepsN ? 'N' : feat === Feat.stepsE ? 'E' : feat === Feat.stepsW ? 'W' : 'S')
      break
    case Role.tree:
      paintLawn(g, gx, gy)
      paintGardenTree(g, 0, 0, tv)
      break
    default:
      return undefined
  }
  tiles.set(key, c)
  return c
}

/** Colours of the two flagpole flags: plain fields, no emblem (L12.6). */
export const FLAG_COLOURS = ['#c8553d', '#4b6fb5'] as const

/** Paint a vertical part (flagpole, chimney, cupola) with its foot at (x, y) pixels, after the chunk's tiles. */
export function paintProp(g: Ctx, kind: SightKind, p: Prop, x: number, y: number): void {
  const s = styleFor(kind, 0)
  switch (p.type) {
    case 'pole': {
      const c = FLAG_COLOURS[p.seed % 2]!
      rect(g, x - 3, y - 2, 6, 3, s.outline)
      rect(g, x - 1, y - 52, 2, 51, s.outline)
      rect(g, x - 1, y - 52, 1, 51, '#e8e4dc')
      rect(g, x - 2, y - 55, 4, 3, '#ffd84a')
      const dir = p.seed % 2 ? -1 : 1
      const fx = dir > 0 ? x + 1 : x - 14
      rect(g, fx - 1, y - 51, 15, 10, s.outline)
      rect(g, fx, y - 50, 13, 8, c)
      rect(g, fx, y - 46, 13, 1, '#00000033')
      rect(g, fx, y - 50, 13, 1, '#ffffff55')
      break
    }
    case 'chimney':
      rect(g, x - 4, y - 14, 8, 14, '#1b1a2e')
      rect(g, x - 3, y - 13, 6, 12, '#a04a3a')
      rect(g, x - 3, y - 13, 2, 12, '#c0624d')
      rect(g, x - 5, y - 16, 10, 3, '#1b1a2e')
      rect(g, x - 4, y - 15, 8, 1, '#5a4a4a')
      break
    case 'cupola': {
      rect(g, x - 7, y - 10, 14, 10, s.outline)
      rect(g, x - 6, y - 9, 12, 8, s.trim)
      rect(g, x - 4, y - 8, 3, 5, s.glass)
      rect(g, x + 1, y - 8, 3, 5, s.glass)
      for (let r = 0; r < 8; r++) {
        const hw = Math.round(Math.sqrt(64 - r * r) * 0.9)
        rect(g, x - hw - 1, y - 18 - r, hw * 2 + 2, 1, s.outline)
        rect(g, x - hw, y - 18 - r, hw * 2, 1, r < 3 ? s.roofB : s.roof)
      }
      rect(g, x - 7, y - 18, 14, 1, s.roofDark)
      rect(g, x - 1, y - 30, 2, 6, s.accent2)
      break
    }
  }
}

/** Translucent drop-shadow strips on a free tile at pixel (x, y): bit 1 east of a building, bit 2 south of one. */
export function paintShade(g: Ctx, bits: number, x: number, y: number): void {
  g.fillStyle = 'rgba(24, 14, 48, 0.3)'
  if (bits & 1) g.fillRect(x, y + 4, 5, 12)
  if (bits & 2) g.fillRect(x, y, 16, 5)
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
