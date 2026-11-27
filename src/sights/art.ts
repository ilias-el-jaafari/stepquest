import type { Sprite } from '../render/sprites.ts'
import { SIGHT_KINDS, type SightKind } from './types.ts'

/**
 * Sight art (landmarks spec, L4): one original sprite per kind, built in code from rectangles on a small
 * grid, then outlined in ink. Nothing is traced from a real building or taken from another game; shapes
 * are generic (a church with a bell tower, a mosque with a dome and a minaret, a synagogue with arched
 * windows and a six-pointed star, a temple with a stepped roof). Sizes are in art pixels (a tile is 16).
 * Pure data, no DOM; `render/sightLayer.ts` paints the atlas.
 */

/** The sight palette (documented in visual-style.md). */
export const SIGHT: Record<string, string> = {
  K: '#1b1a2e', // ink outline
  W: '#f4ead2', // wall
  w: '#d3c3a0', // wall shade
  S: '#cfc8b8', // stone
  s: '#a39a86', // stone shade
  l: '#ebe5d6', // stone light
  R: '#c8553d', // terracotta roof
  r: '#8f3a2c', // roof shade
  B: '#4b6fb5', // blue
  b: '#2f4a82', // blue shade
  T: '#2fa59a', // teal dome
  t: '#1d6f6a', // teal shade
  G: '#ffd84a', // gold
  g: '#c99a10', // gold shade
  V: '#5d93c9', // window glass (lit at night)
  D: '#8a5a3a', // door wood
  d: '#5a381e', // door shade
  P: '#8d5bb0', // plum roof
  p: '#5b3379', // plum shade
  H: '#fbf7ec', // white
  N: '#5d8c4a', // green
  A: '#7fc4ff', // water
  a: '#bfe4ff', // water light
}
/** Warm window light for the night overlay. */
export const SIGHT_LIT = '#ffe27a'

type Cell = string
class Grid {
  readonly w: number
  readonly h: number
  private readonly c: Cell[][]
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.c = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'))
  }
  set(x: number, y: number, ch: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y]![x] = ch
    return this
  }
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch)
    return this
  }
  /** A centred triangle: row k of `rows` is `first + 2 * k * step` wide, around column `cx` (the left of the middle pair). */
  tri(cx: number, y: number, rows: number, first: number, step: number, ch: string): this {
    for (let k = 0; k < rows; k++) {
      const w = first + 2 * k * step
      this.rect(cx + 1 - Math.floor(w / 2) - (w % 2 ? 0 : 0), y + k, w, 1, ch)
    }
    return this
  }
  /** A 2×3 window (glass) with a light sill. */
  win(x: number, y: number, h = 3, sill = 'w'): this {
    this.rect(x, y, 2, h, 'V')
    if (sill) this.rect(x, y + h, 2, 1, sill)
    return this
  }
  /** An arched window: glass with a rounded top. */
  arch(x: number, y: number, h: number): this {
    this.rect(x, y + 1, 2, h - 1, 'V')
    return this.set(x, y, '.').set(x + 1, y, '.').rect(x, y, 2, 1, 'V')
  }
  rows(): string[] {
    return this.c.map((r) => r.join(''))
  }
}

/** Ink all around the silhouette (4-connected), in a copy one pixel larger on every side. */
function outlined(g: Grid): string[] {
  const src = g.rows()
  const h = src.length + 2
  const w = (src[0]?.length ?? 0) + 2
  const filled = (x: number, y: number) => (src[y - 1]?.[x - 1] ?? '.') !== '.'
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) row += src[y - 1]![x - 1]
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) row += 'K'
      else row += '.'
    }
    out.push(row)
  }
  return out
}

/** A six-pointed star (9 × 8), a religious symbol: two overlapping triangles. */
const STAR = ['....G....', '...GGG...', 'GGGGGGGGG', '.GGGGGGG.', '.GGGGGGG.', 'GGGGGGGGG', '...GGG...', '....G....']

/** The six-pointed star as rows, for tests and the synagogue front. */
export function starRows(): string[] {
  return STAR.slice()
}

function university(): Grid {
  const g = new Grid(24, 21)
  // Pediment with a gold emblem, a blue band and a stone entablature.
  g.tri(11, 0, 5, 2, 2, 'S')
  g.rect(10, 2, 4, 2, 'G').rect(11, 2, 2, 1, 'g')
  g.rect(2, 5, 20, 1, 'B').rect(2, 6, 20, 1, 'l').rect(2, 7, 20, 1, 's')
  // Wall behind the columns.
  g.rect(3, 8, 18, 9, 'w')
  g.arch(6, 9, 5).arch(16, 9, 5)
  g.rect(10, 11, 4, 6, 'D').rect(10, 11, 4, 1, 'd').rect(11, 12, 1, 5, 'd')
  // Four columns with capitals and bases.
  for (const x of [3, 7, 15, 19]) {
    g.rect(x, 8, 2, 1, 'l').rect(x, 9, 2, 8, 'W').rect(x + 1, 9, 1, 8, 'w').rect(x, 17, 2, 1, 's')
  }
  // Steps.
  g.rect(1, 17, 22, 1, 'S').rect(0, 18, 24, 1, 'l').rect(0, 19, 24, 1, 'S').rect(0, 20, 24, 1, 's')
  return g
}

function school(): Grid {
  const g = new Grid(24, 18)
  // A little bell tower with a flag on the roof, a long low front with many windows.
  g.rect(10, 0, 1, 3, 'K').rect(11, 0, 3, 2, 'R')
  g.rect(9, 3, 6, 4, 'W').rect(9, 3, 6, 1, 'r').rect(11, 4, 2, 3, 'G').rect(11, 6, 2, 1, 'g')
  g.rect(8, 7, 8, 1, 'R').rect(8, 8, 8, 1, 'r')
  g.rect(1, 9, 22, 2, 'R').rect(1, 11, 22, 1, 'r')
  g.rect(2, 12, 20, 5, 'W').rect(21, 12, 1, 5, 'w')
  for (const x of [3, 6, 15, 18]) g.win(x, 13, 3, '')
  g.rect(10, 13, 4, 4, 'D').rect(10, 13, 4, 1, 'd').rect(11, 14, 1, 3, 'd')
  g.rect(1, 17, 22, 1, 's')
  return g
}

function hospital(): Grid {
  const g = new Grid(22, 22)
  // A white block with a teal cross on a sign, rows of windows and a covered entrance.
  g.rect(8, 0, 6, 6, 'T').rect(8, 5, 6, 1, 't').rect(10, 1, 2, 4, 'H').rect(9, 2, 4, 2, 'H')
  g.rect(2, 6, 18, 1, 'S').rect(2, 7, 18, 12, 'H').rect(19, 7, 1, 12, 'w').rect(2, 7, 18, 1, 'l')
  for (const y of [8, 12]) for (const x of [4, 8, 12, 16]) g.win(x, y, 2, '')
  g.rect(7, 15, 8, 1, 'T').rect(7, 16, 8, 1, 't').rect(8, 16, 6, 3, 'V').rect(10, 16, 2, 3, 'w')
  g.rect(2, 19, 18, 1, 's').rect(1, 20, 20, 1, 'S').rect(0, 21, 22, 1, 'l')
  return g
}

function church(): Grid {
  const g = new Grid(22, 28)
  // Bell tower on the left with a spire and a cross; nave with a gable and a rose window.
  g.rect(5, 0, 1, 3, 'G').rect(4, 1, 3, 1, 'G')
  g.tri(5, 3, 5, 2, 1, 'R').rect(4, 3, 2, 5, 'R')
  g.tri(5, 3, 5, 2, 1, 'R')
  g.rect(2, 8, 8, 1, 'r').rect(2, 9, 8, 11, 'W').rect(9, 9, 1, 11, 'w')
  g.rect(4, 10, 4, 5, 'K').rect(5, 11, 2, 3, 'V').rect(5, 11, 2, 1, 'G')
  g.rect(2, 16, 8, 1, 's')
  g.tri(15, 12, 4, 4, 2, 'R')
  g.rect(10, 16, 11, 1, 'r').rect(11, 17, 10, 8, 'W').rect(20, 17, 1, 8, 'w')
  g.rect(14, 18, 4, 4, 'G').rect(15, 19, 2, 2, 'V')
  g.rect(14, 22, 4, 3, 'D').rect(14, 22, 4, 1, 'd').rect(15, 23, 1, 2, 'd')
  g.rect(12, 19, 1, 3, 'V').rect(19, 19, 1, 3, 'V')
  g.rect(2, 20, 8, 5, 'W').rect(9, 20, 1, 5, 'w').arch(4, 21, 4)
  g.rect(1, 25, 21, 1, 's').rect(0, 26, 22, 1, 'S').rect(0, 27, 22, 1, 'l')
  // The bell tower reaches higher than the nave: cross on top.
  return g
}

function mosque(): Grid {
  const g = new Grid(26, 27)
  // Minaret on the right with a balcony and a pointed cap; a central dome on a drum; a low hall with arches.
  g.rect(21, 0, 1, 2, 'G').rect(20, 1, 3, 1, 'g')
  g.tri(21, 2, 4, 2, 1, 'T').rect(20, 5, 3, 2, 'T')
  g.rect(19, 7, 5, 1, 's').rect(19, 8, 5, 1, 'S')
  g.rect(20, 9, 3, 12, 'W').rect(22, 9, 1, 12, 'w').rect(21, 11, 1, 2, 'V').rect(21, 15, 1, 2, 'V')
  // Dome: a half disc.
  g.rect(12, 2, 1, 2, 'G').rect(11, 3, 3, 1, 'g')
  const dome = [4, 8, 10, 12, 12]
  dome.forEach((w, k) => g.rect(12 - Math.floor(w / 2) + 0, 4 + k, w, 1, k < 4 ? 'T' : 't'))
  g.rect(8, 6, 2, 1, 'H').rect(9, 5, 1, 1, 'H')
  g.rect(5, 9, 14, 7, 'W').rect(18, 9, 1, 7, 'w')
  g.rect(5, 9, 14, 1, 'l')
  g.arch(7, 11, 5).arch(11, 11, 5).arch(15, 11, 5)
  g.rect(1, 16, 18, 1, 's').rect(1, 17, 18, 1, 'S')
  // The front hall.
  g.rect(1, 18, 18, 7, 'W').rect(18, 18, 1, 7, 'w')
  for (const x of [3, 7, 14]) g.arch(x, 19, 4)
  g.rect(10, 19, 4, 6, 'D').rect(10, 19, 4, 1, 'd').rect(11, 20, 2, 5, 'd')
  g.rect(0, 25, 24, 1, 'S').rect(0, 26, 24, 1, 'l')
  return g
}

function synagogue(): Grid {
  const g = new Grid(22, 24)
  // A broad front with a stepped gable, a gold six-pointed star, and tall arched windows.
  g.tri(10, 0, 4, 4, 2, 'B').rect(2, 4, 18, 1, 'b')
  g.rect(2, 5, 18, 14, 'W').rect(19, 5, 1, 14, 'w')
  starRows().forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.set(6 + x, 6 + y, row[x]!)
  })
  g.rect(9, 9, 3, 2, 'g')
  for (const x of [3, 16]) g.arch(x, 8, 7)
  g.rect(9, 14, 4, 5, 'D').rect(9, 14, 4, 1, 'd').rect(10, 15, 2, 4, 'd')
  g.rect(8, 13, 6, 1, 'B')
  g.rect(1, 19, 20, 1, 'S').rect(0, 20, 22, 1, 'l').rect(0, 21, 22, 1, 'S').rect(0, 22, 22, 1, 's')
  return g
}

function temple(): Grid {
  const g = new Grid(24, 24)
  // Two stepped plum roofs with upturned eaves, a gold finial, red-free walls and four columns.
  g.rect(11, 0, 2, 3, 'G').rect(11, 2, 2, 1, 'g')
  g.rect(8, 3, 8, 2, 'P').rect(5, 5, 14, 2, 'P').rect(5, 7, 14, 1, 'p')
  g.rect(3, 4, 2, 1, 'P').rect(19, 4, 2, 1, 'P')
  g.rect(8, 8, 8, 4, 'W').rect(15, 8, 1, 4, 'w').win(11, 9, 2, '')
  g.rect(2, 12, 20, 2, 'P').rect(1, 11, 2, 1, 'P').rect(21, 11, 2, 1, 'P').rect(2, 14, 20, 1, 'p')
  g.rect(3, 15, 18, 6, 'W').rect(20, 15, 1, 6, 'w')
  for (const x of [3, 8, 14, 19]) g.rect(x, 15, 2, 6, 'S').rect(x + 1, 15, 1, 6, 's')
  g.rect(10, 16, 4, 5, 'D').rect(10, 16, 4, 1, 'd').rect(11, 17, 2, 4, 'd')
  g.rect(1, 21, 22, 1, 'l').rect(0, 22, 24, 1, 'S').rect(0, 23, 24, 1, 's')
  return g
}

function townHall(): Grid {
  const g = new Grid(26, 26)
  // A clock tower with a pointed cap and a flag over a wide hall with a balcony.
  g.rect(12, 0, 1, 3, 'K').rect(13, 0, 3, 2, 'B')
  g.tri(12, 3, 3, 2, 1, 'B')
  g.rect(9, 6, 8, 8, 'W').rect(16, 6, 1, 8, 'w').rect(9, 6, 8, 1, 'l')
  g.rect(10, 7, 6, 6, 'H').rect(12, 8, 2, 4, 'S').rect(12, 9, 2, 1, 'K').rect(13, 8, 1, 3, 'K')
  g.rect(8, 14, 10, 1, 'b').rect(8, 15, 10, 1, 's')
  g.rect(1, 16, 24, 1, 'B').rect(1, 17, 24, 1, 'b')
  g.rect(2, 18, 22, 6, 'W').rect(23, 18, 1, 6, 'w')
  g.rect(9, 18, 8, 1, 'G').rect(9, 19, 8, 1, 'g')
  for (const x of [4, 7, 18, 21]) g.arch(x, 19, 4)
  g.rect(11, 20, 4, 4, 'D').rect(11, 20, 4, 1, 'd').rect(12, 21, 2, 3, 'd')
  g.rect(1, 24, 24, 1, 'S').rect(0, 25, 26, 1, 'l')
  return g
}

function tower(): Grid {
  const g = new Grid(14, 30)
  // A slim stone tower with crenellations, arrow slits and a gold pennant.
  g.rect(6, 0, 1, 3, 'K').rect(7, 0, 3, 2, 'G')
  for (const x of [2, 5, 8]) g.rect(x, 3, 2, 2, 'S')
  g.rect(2, 5, 10, 2, 'l').rect(2, 7, 10, 1, 's')
  g.rect(3, 8, 8, 15, 'S').rect(10, 8, 1, 15, 's').rect(3, 8, 1, 15, 'l')
  for (let y = 9; y < 22; y += 4) g.rect(6, y, 2, 3, 'K')
  g.rect(4, 12, 1, 1, 's').rect(8, 16, 1, 1, 's').rect(5, 20, 1, 1, 's')
  g.rect(5, 18, 4, 5, 'D').rect(5, 18, 4, 1, 'd').rect(6, 19, 2, 4, 'd')
  g.rect(1, 23, 12, 2, 'S').rect(0, 25, 14, 2, 'l').rect(0, 27, 14, 1, 'S').rect(0, 28, 14, 1, 's')
  return g
}

function arch(): Grid {
  const g = new Grid(24, 22)
  // A gate with two piers, a round opening, an attic with a gold inscription band and two small turrets.
  g.rect(2, 0, 3, 3, 'S').rect(19, 0, 3, 3, 'S').rect(2, 0, 3, 1, 'l').rect(19, 0, 3, 1, 'l')
  g.rect(2, 3, 20, 4, 'S').rect(2, 3, 20, 1, 'l').rect(2, 6, 20, 1, 's').rect(6, 4, 12, 2, 'g').rect(7, 4, 10, 1, 'G')
  g.rect(1, 7, 22, 12, 'S').rect(1, 7, 22, 1, 'l')
  g.rect(1, 7, 1, 12, 'l').rect(22, 7, 1, 12, 's')
  // Round opening, dark inside with a lighter far side.
  const open = [6, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12]
  open.forEach((w, k) => g.rect(12 - Math.floor(w / 2), 8 + k, w, 1, k > 6 ? 'd' : 'K'))
  g.rect(8, 12, 8, 7, 'd').rect(10, 9, 4, 3, 'd')
  g.rect(4, 8, 1, 2, 'V').rect(19, 8, 1, 2, 'V').rect(4, 12, 1, 2, 'V').rect(19, 12, 1, 2, 'V')
  g.rect(0, 19, 24, 1, 'l').rect(0, 20, 24, 1, 'S').rect(0, 21, 24, 1, 's')
  return g
}

function statue(): Grid {
  const g = new Grid(14, 26)
  // A figure with a raised torch on a column and a stepped base; gold, as a bronze would gleam.
  g.rect(8, 0, 2, 2, 'G').rect(8, 0, 1, 1, 'H')
  g.rect(7, 2, 1, 4, 'g').rect(6, 4, 2, 5, 'G').rect(5, 3, 4, 1, 'G')
  g.rect(4, 6, 6, 1, 'G').rect(5, 5, 3, 1, 'G').rect(5, 7, 5, 6, 'G').rect(8, 7, 2, 6, 'g').rect(4, 7, 1, 4, 'g')
  g.rect(5, 13, 2, 3, 'G').rect(8, 13, 2, 3, 'g')
  g.rect(3, 16, 8, 1, 'l').rect(4, 17, 6, 5, 'S').rect(9, 17, 1, 5, 's').rect(5, 18, 4, 1, 's')
  g.rect(2, 22, 10, 1, 'l').rect(1, 23, 12, 1, 'S').rect(0, 24, 14, 1, 'S').rect(0, 25, 14, 1, 's')
  return g
}

function fountain(): Grid {
  const g = new Grid(22, 18)
  // A three-tier fountain: a round basin, a stem with a bowl, and a jet of water.
  g.rect(10, 0, 2, 3, 'a').rect(9, 3, 4, 1, 'A').rect(8, 3, 1, 1, 'a').rect(13, 3, 1, 1, 'a')
  g.rect(9, 4, 4, 1, 'S').rect(10, 5, 2, 4, 'S').rect(11, 5, 1, 4, 's')
  g.rect(6, 8, 10, 1, 'l').rect(5, 9, 12, 2, 'S').rect(6, 8, 10, 1, 'l').rect(7, 9, 8, 1, 'A').rect(8, 9, 3, 1, 'a')
  g.rect(10, 11, 2, 2, 's')
  g.rect(2, 12, 18, 1, 'l').rect(1, 13, 20, 1, 'S').rect(0, 14, 22, 2, 'S').rect(0, 14, 22, 1, 'l')
  g.rect(3, 14, 16, 1, 'A').rect(5, 14, 4, 1, 'a').rect(1, 16, 20, 1, 'S').rect(2, 17, 18, 1, 's')
  return g
}

const BUILDERS: Record<SightKind, () => Grid> = {
  university,
  school,
  hospital,
  church,
  mosque,
  synagogue,
  temple,
  townHall,
  tower,
  arch,
  statue,
  fountain,
}

/** One sprite per kind: day colours, ink outline included. */
export const SIGHT_SPRITES: Record<SightKind, Sprite> = Object.fromEntries(SIGHT_KINDS.map((k) => [k, { rows: outlined(BUILDERS[k]()), colors: SIGHT }])) as Record<SightKind, Sprite>

/** The night overlay of a sprite: only its window glass, in warm light (drawn after the tint). */
export function litOverlay(s: Sprite): Sprite {
  return { rows: s.rows.map((r) => r.replace(/[^V]/g, '.').replace(/V/g, 'Y')), colors: { Y: SIGHT_LIT } }
}
export const SIGHT_LIT_SPRITES: Record<SightKind, Sprite> = Object.fromEntries(SIGHT_KINDS.map((k) => [k, litOverlay(SIGHT_SPRITES[k])])) as Record<SightKind, Sprite>

export const spriteSize = (k: SightKind): { w: number; h: number } => ({ w: SIGHT_SPRITES[k].rows[0]?.length ?? 0, h: SIGHT_SPRITES[k].rows.length })

export type AtlasSlot = { x: number; y: number; w: number; h: number }
export type SightAtlasLayout = { width: number; height: number; day: Record<SightKind, AtlasSlot>; lit: Record<SightKind, AtlasSlot> }

const ATLAS_WIDTH = 160

/** Day frames, then lit overlays, packed in rows with a 1 px gap. */
export function sightAtlasLayout(): SightAtlasLayout {
  const day = {} as Record<SightKind, AtlasSlot>
  const lit = {} as Record<SightKind, AtlasSlot>
  let x = 0
  let y = 0
  let rowH = 0
  for (const frames of [day, lit]) {
    for (const k of SIGHT_KINDS) {
      const { w, h } = spriteSize(k)
      if (x + w > ATLAS_WIDTH) {
        x = 0
        y += rowH + 1
        rowH = 0
      }
      frames[k] = { x, y, w, h }
      x += w + 1
      rowH = Math.max(rowH, h)
    }
  }
  return { width: ATLAS_WIDTH, height: y + rowH, day, lit }
}
