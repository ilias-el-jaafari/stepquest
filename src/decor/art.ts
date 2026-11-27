import type { Sprite } from '../render/sprites.ts'

/**
 * Halloween decor art (halloween-decor spec): small sprites drawn as character grids, our own designs,
 * painted once into an offscreen atlas (`atlasLayout`, `render/decorLayer.ts`). Sizes are in art pixels
 * (a map tile is 16). Pure data, no DOM.
 */

/** The decor palette (documented in visual-style.md). */
export const DECOR = {
  ink: '#1b1a2e',
  pumpkin: '#f08a24',
  pumpkinShade: '#b3500f',
  pumpkinLight: '#ffc060',
  stem: '#3f7a2a',
  faceUnlit: '#4a2410',
  faceLit: '#ffd84a',
  bone: '#efe9d6',
  boneShade: '#b9b09a',
  bat: '#8a78c0',
  batLight: '#5a4a7a',
  stone: '#a7a3b5',
  stoneShade: '#6f6b82',
  stoneMark: '#4d4a60',
  moss: '#5d8c4a',
  web: '#e8e6f2',
  crow: '#25222f',
  crowSheen: '#5b5878',
  beak: '#e0a030',
  wax: '#f4ecd0',
  flame: '#ffb02e',
  flameCore: '#fff0a0',
  lanternRed: '#d9412c',
  lanternDark: '#8f2a1e',
  lanternOff: '#a05a2a',
  hat: '#4b2a6e',
  hatLight: '#6e44a0',
  hatBand: '#ffd84a',
  fog: '#cfd6ee',
  glow: '#ffa23c',
  pumpkinRib: '#d06a14',
  sack: '#d9b16a',
  sackShade: '#a8803f',
  straw: '#e6c45a',
  shirt: '#b5502e',
  patch: '#4b7aa8',
  wood: '#8a5a32',
  woodDark: '#5a381e',
  woodLight: '#b98550',
  iron: '#3a3850',
  ironLight: '#6a6890',
  ironRim: '#55527a',
  brew: '#7be04a',
  brewLight: '#c8ff8a',
  fire: '#ff8a1e',
  picket: '#efe9d6',
  picketShade: '#b9b09a',
  thread: '#d8d8e8',
  spider: '#3a2a5e',
  spiderMark: '#ff6a2e',
  batEye: '#ff5a5a',
} as const

const C = DECOR

/** Every sprite id; a sprite has one or more frames, named `${id}${frame}` in the atlas. */
export const SPRITE_IDS = ['pumpkin', 'pumpkinS', 'jack', 'jackLit', 'bat', 'web', 'skeleton', 'grave', 'crow', 'candle', 'candleLit', 'lantern', 'lanternLit', 'hat', 'fog', 'glow', 'scarecrow', 'cauldron', 'cauldronLit', 'sign', 'fence', 'spider'] as const
export type SpriteId = (typeof SPRITE_IDS)[number]

function patched(rows: readonly string[], patch: readonly (readonly [number, number, string])[]): string[] {
  const grid = rows.map((r) => [...r])
  for (const [y, x, ch] of patch) grid[y]![x] = ch
  return grid.map((r) => r.join(''))
}

/** A blank character grid. */
function blank(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'))
}

/**
 * A pumpkin drawn by rule at any size: a ribbed ellipse with a darker rim, a highlight, a shaded lower right,
 * a stem and a leaf. The jack-o'-lantern is the 13 × 12 one with a carved face patched on.
 */
export function pumpkinRows(w: number, h: number): string[] {
  const g = blank(w, h)
  const stemH = h >= 10 ? 3 : 2
  const cx = (w - 1) / 2
  const rx = w / 2 - 0.2
  const top = stemH - 1
  const cy = top + (h - top) / 2 - 0.5
  const ry = (h - top) / 2 - 0.1
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  for (let y = top; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      let ch = edge ? 'd' : 'o'
      if (!edge && w >= 10 && (Math.abs(x - cx) > 2.4 && Math.abs(x - cx) < 3.6)) ch = 'r'
      if (!edge && x - cx + (y - cy) > w * 0.55) ch = 'r'
      g[y]![x] = ch
    }
  }
  // Highlight on the upper left.
  const hx = Math.round(cx - rx * 0.45)
  const hy = Math.round(cy - ry * 0.45)
  g[hy]![hx] = 'h'
  if (w >= 10) {
    g[hy]![hx + 1] = 'h'
    g[hy + 1]![hx] = 'h'
  }
  // Stem and leaf.
  const sx = Math.floor(cx)
  for (let y = 0; y < stemH; y++) g[y]![sx] = 's'
  g[stemH - 1]![sx + 1] = 's'
  if (w >= 10) g[0]![sx + 1] = 's'
  return g.map((r) => r.join(''))
}

const PUMPKIN_ROWS = pumpkinRows(13, 12)
const PUMPKIN_SMALL = pumpkinRows(8, 7)
/** Carved face of the jack-o'-lantern: two triangle eyes, a nose and a zigzag grin ('f' shows the candle). */
const JACK_FACE: readonly (readonly [number, number, string])[] = [
  [4, 3, 'f'], [5, 2, 'f'], [5, 3, 'f'], [5, 4, 'f'],
  [4, 9, 'f'], [5, 8, 'f'], [5, 9, 'f'], [5, 10, 'f'],
  [6, 6, 'f'], [7, 6, 'f'],
  [8, 2, 'f'], [8, 4, 'f'], [8, 6, 'f'], [8, 8, 'f'], [8, 10, 'f'],
  [9, 3, 'f'], [9, 4, 'f'], [9, 5, 'f'], [9, 6, 'f'], [9, 7, 'f'], [9, 8, 'f'], [9, 9, 'f'],
]
const JACK_ROWS = patched(PUMPKIN_ROWS, JACK_FACE)
const pumpkinColors = { s: C.stem, d: C.pumpkinShade, o: C.pumpkin, h: C.pumpkinLight, r: C.pumpkinRib }
const jackColors = (face: string) => ({ s: C.stem, d: C.pumpkinShade, o: C.pumpkin, r: C.pumpkinRib, h: C.pumpkinLight, f: face })

const BAT_UP = patched(['bb.........bb', 'bbb..b.b..bbb', 'bbbb.bbb.bbbb', '.bbbbbbbbbbb.', '..bbbbbbbbb..', '...b.bbb.b...', '......b......'], [[2, 5, 'e'], [2, 7, 'e']])
const BAT_DOWN = patched(['...b.....b...', '..bbb.b.bbb..', '.bbbbbbbbbbb.', 'bbbbbbbbbbbbb', 'bb.bbbbbbb.bb', 'b...bbbbb...b', '......b......'], [[2, 5, 'e'], [2, 7, 'e']])

/** An 8×8 web in the top-left corner: two spokes along the edges, a diagonal and two arcs (drawn by a rule, not by hand). */
function webRows(): string[] {
  const rows: string[] = []
  for (let y = 0; y < 8; y++) {
    let row = ''
    for (let x = 0; x < 8; x++) {
      const r = Math.hypot(x, y)
      const spoke = x === 0 || y === 0 || x === y
      const arc = Math.abs(r - 3) < 0.55 || Math.abs(r - 6) < 0.55
      row += spoke || arc ? 'w' : '.'
    }
    rows.push(row)
  }
  return rows
}

/** The web mirrored for the four corners: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
export function webCorner(corner: number): string[] {
  let rows = webRows()
  if (corner & 1) rows = rows.map((r) => [...r].reverse().join(''))
  if (corner & 2) rows = [...rows].reverse()
  return rows
}

const SKELETON = [
  '...bbbbbb...',
  '..bbbbbbbb..',
  '..bkkbbkkb..',
  '..bkkbbkkb..',
  '..bbbkkbbb..',
  '...bbbbbb...',
  '...b.bb.b...',
  '..bbbbbbbb..',
  '.bb.bbbb.bb.',
  '.b..bkkb..b.',
  '.b..bbbb..b.',
  '....bkkb....',
  '...bbbbbb...',
  '..bbbb..bbbb',
  'bbb......bbb',
]
const SKELETON_WAVE = patched(SKELETON, [[8, 9, '.'], [8, 10, '.'], [9, 10, '.'], [10, 10, '.'], [7, 10, 'b'], [7, 11, 'b'], [6, 11, 'b'], [5, 11, 'b'], [4, 11, 'b']])

/** A gravestone by rule: shape 0 arched with a cross, 1 flat slab with lines, 2 a cross-shaped stone. 10 × 12 art pixels. */
export function graveRows(shape: number): string[] {
  const w = 10
  const h = 12
  const g = blank(w, h)
  const fill = (x0: number, x1: number, y0: number, y1: number, ch: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y]![x] = ch
  }
  if (shape === 0) {
    fill(1, 8, 3, 9, 'g')
    fill(2, 7, 1, 2, 'g')
    fill(3, 6, 0, 0, 'g')
    fill(4, 5, 3, 7, 'c')
    fill(3, 6, 4, 4, 'c')
  } else if (shape === 1) {
    fill(1, 8, 1, 9, 'g')
    fill(3, 6, 3, 3, 'c')
    fill(3, 6, 5, 5, 'c')
    fill(3, 5, 7, 7, 'c')
  } else {
    fill(4, 5, 0, 9, 'g')
    fill(1, 8, 2, 4, 'g')
    fill(4, 5, 2, 7, 'g')
    fill(4, 5, 6, 7, 'c')
  }
  // Shaded right edge, ground and moss.
  for (let y = 0; y <= 9; y++) {
    const last = g[y]!.lastIndexOf('g')
    if (last >= 0 && y > 1) g[y]![last] = 'd'
  }
  fill(0, 9, 10, 11, 'd')
  g[10]![0] = 'm'
  g[10]![1] = 'm'
  g[10]![8] = 'm'
  g[11]![9] = 'm'
  g[9]![1] = 'm'
  return g.map((r) => r.join(''))
}
const graveColors = { g: C.stone, d: C.stoneShade, c: C.stoneMark, m: C.moss }

const CROW = ['...kkkk....', '..kkkwkkyy.', '..kkkkkk...', '.kkkkkkkk..', 'kkwkkkkkk..', 'kkkkkkkkk..', '.kkkkkkk...', '..kkkkk....', '...y.y.....']
const CANDLE = ['..ff..', '.fFFf.', '..FF..', '..kk..', '.wwww.', '.wwww.', '.wwww.', '.wwww.', '.wwww.', 'dddddd', 'dddddd']
const CANDLE_OFF = patched(CANDLE, [[0, 2, '.'], [0, 3, '.'], [1, 1, '.'], [1, 2, '.'], [1, 3, '.'], [1, 4, '.'], [2, 2, '.'], [2, 3, '.']])
const LANTERN = ['...kkk...', '..k...k..', '.kkkkkkk.', '.krrrrrk.', '.krRyRrk.', '.krRyRrk.', '.krRyRrk.', '.krrrrrk.', '.kkkkkkk.', '..k...k..']
const HAT = ['.....pp.', '....ppp.', '...pppp.', '...bbbb.', '..pppppp', 'pppppppp']

/** A drifting fog wisp by rule: three overlapping ellipses, 20 × 9, with a few holes for a ragged edge. */
function fogRows(): string[] {
  const g = blank(20, 9)
  const blobs: readonly (readonly [number, number, number, number])[] = [[10, 4, 9, 3.6], [4.5, 5.5, 4.5, 2.6], [15.5, 5.2, 4.5, 2.8]]
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 20; x++) {
      if (!blobs.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1)) continue
      if ((x * 7 + y * 13) % 11 === 0) continue
      g[y]![x] = 'f'
    }
  }
  return g.map((r) => r.join(''))
}
const FOG = fogRows()

const SCARECROW = [
  '.....hhh.....',
  '...hhhhhhh...',
  '.hhhhhhhhhhh.',
  '....sssss....',
  '....sksks....',
  '....sssss....',
  '....skkks....',
  '.....ppp.....',
  'yrrrrrrrrrrry',
  'y..rrrrrrr..y',
  '...rrcrrrr...',
  '...rrrrrrr...',
  '...rrrrrrr...',
  '..yyyyyyyyy..',
  '...y.y.y.y...',
  '......p......',
  '......p......',
  '......p......',
  '......p......',
  '.....ppp.....',
]

const CAULDRON = [
  '....o....o....',
  '...........o..',
  '..kkkkkkkkkk..',
  '.kqqqqqqqqqqk.',
  'kkkkkkkkkkkkkk',
  '.kkkkkkkkkkkk.',
  'kkkhkkkkkkkkkk',
  'kkkkkkkkkkkkkk',
  '.kkkkkkkkkkkk.',
  '..kkkkkkkkkk..',
  '..k..kkkk..k..',
  '.kk..LLLL..kk.',
]
const CAULDRON_LIT = patched(CAULDRON, [[11, 5, 'F'], [11, 6, 'F'], [11, 7, 'F'], [11, 8, 'F'], [10, 6, 'F'], [10, 7, 'F']])

const SIGN = [
  '..wwwwwwwww.',
  '.wwkwkkwkwww',
  '..wwwwwwwww.',
  '....pp......',
  '....pp......',
  '.wwwwwwww...',
  'wwkkwkwkww..',
  '.wwwwwwww...',
  '....pp......',
  '....pp......',
  '....pp......',
  '....pp......',
  '....pp......',
  '....pp......',
  '....pp......',
  '...pppp.....',
  '..pppppp....',
]

/** A picket fence, one tile wide, with a small pumpkin in front. */
function fenceRows(): string[] {
  const g = blank(16, 11)
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 16; x++) {
      const post = x % 4 !== 3
      if (y === 0) g[y]![x] = x % 4 === 1 ? 'w' : '.'
      else if (y === 3 || y === 7) g[y]![x] = 'w'
      else if (post) g[y]![x] = x % 4 === 2 ? 'v' : 'w'
    }
  }
  const small = pumpkinRows(7, 6)
  small.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g[y + 5]![x + 8] = row[x]!
  })
  return g.map((r) => r.join(''))
}

const SPIDER = [
  '....l....',
  '....l....',
  '....l....',
  '....l....',
  '....l....',
  '....l....',
  '....l....',
  '...kkk...',
  'k.kkkkk.k',
  '.kkkokkk.',
  'k.kkkkk.k',
  '..k...k..',
]

/** A 16×16 glow in three stepped rings (pixel look): faint outside, brighter inside. */
function glowRows(): string[] {
  const rows: string[] = []
  for (let y = 0; y < 16; y++) {
    let row = ''
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5)
      row += r < 2.6 ? 'c' : r < 5 ? 'b' : r < 7.6 ? 'a' : '.'
    }
    rows.push(row)
  }
  return rows
}

const sprite = (rows: readonly string[], colors: Record<string, string>): Sprite => ({ rows: [...rows], colors })

/** All frames per sprite id. Frame order is the animation order. */
export const DECOR_FRAMES: Record<SpriteId, readonly Sprite[]> = {
  pumpkin: [sprite(PUMPKIN_ROWS, pumpkinColors)],
  pumpkinS: [sprite(PUMPKIN_SMALL, pumpkinColors)],
  jack: [sprite(JACK_ROWS, jackColors(C.faceUnlit))],
  jackLit: [sprite(JACK_ROWS, jackColors(C.faceLit))],
  bat: [sprite(BAT_UP, { b: C.bat, e: C.batEye }), sprite(BAT_DOWN, { b: C.bat, e: C.batEye })],
  web: [0, 1, 2, 3].map((c) => sprite(webCorner(c), { w: C.web })),
  // Sitting skeleton; frame 1 waves a raised right arm.
  skeleton: [sprite(SKELETON, { b: C.bone, k: C.ink }), sprite(SKELETON_WAVE, { b: C.bone, k: C.ink })],
  grave: [0, 1, 2].map((v) => sprite(graveRows(v), graveColors)),
  crow: [sprite(CROW, { k: C.crow, w: C.crowSheen, y: C.beak })],
  candle: [sprite(CANDLE_OFF, { k: C.ink, w: C.wax, d: C.stoneShade })],
  candleLit: [sprite(CANDLE, { f: C.flameCore, F: C.flame, k: C.ink, w: C.wax, d: C.stoneShade })],
  lantern: [sprite(LANTERN, { k: C.ink, r: C.lanternDark, R: C.lanternDark, y: C.lanternOff })],
  lanternLit: [sprite(LANTERN, { k: C.ink, r: C.lanternRed, R: C.lanternDark, y: C.faceLit })],
  hat: [sprite(HAT, { p: C.hat, b: C.hatBand })],
  fog: [sprite(FOG, { f: C.fog })],
  glow: [sprite(glowRows(), { a: 'rgba(255,162,60,0.10)', b: 'rgba(255,162,60,0.22)', c: 'rgba(255,200,110,0.40)' })],
  scarecrow: [sprite(SCARECROW, { h: C.woodDark, s: C.sack, k: C.ink, p: C.wood, y: C.straw, r: C.shirt, c: C.patch })],
  cauldron: [sprite(CAULDRON, { o: C.brewLight, q: C.brew, k: C.iron, h: C.ironLight, L: C.woodDark })],
  cauldronLit: [sprite(CAULDRON_LIT, { o: C.brewLight, q: C.brew, k: C.iron, h: C.ironLight, L: C.woodDark, F: C.fire })],
  sign: [sprite(SIGN, { w: C.woodLight, k: C.woodDark, p: C.wood })],
  fence: [sprite(fenceRows(), { w: C.picket, v: C.picketShade, s: C.stem, d: C.pumpkinShade, o: C.pumpkin, h: C.pumpkinLight, r: C.pumpkinRib })],
  spider: [sprite(SPIDER, { l: C.thread, k: C.spider, o: C.spiderMark })],
}

/** Size of a sprite's frames in art pixels. */
export function spriteSize(id: SpriteId): { w: number; h: number } {
  const f = DECOR_FRAMES[id][0]!
  return { w: f.rows[0]!.length, h: f.rows.length }
}

export const ATLAS_WIDTH = 128

export type AtlasSlot = { x: number; y: number; w: number; h: number }
export type AtlasLayout = { width: number; height: number; slots: Record<string, AtlasSlot>; frames: number }

export const frameName = (id: SpriteId, frame: number): string => `${id}${frame}`

/** Row-packed layout with a 1 px gutter. Pure and deterministic; the atlas size is a golden in the tests. */
export function atlasLayout(): AtlasLayout {
  const slots: Record<string, AtlasSlot> = {}
  let x = 0
  let y = 0
  let rowH = 0
  let frames = 0
  for (const id of SPRITE_IDS) {
    const { w, h } = spriteSize(id)
    DECOR_FRAMES[id].forEach((_, i) => {
      if (x + w > ATLAS_WIDTH) {
        x = 0
        y += rowH + 1
        rowH = 0
      }
      slots[frameName(id, i)] = { x, y, w, h }
      x += w + 1
      rowH = Math.max(rowH, h)
      frames++
    })
  }
  return { width: ATLAS_WIDTH, height: y + rowH, slots, frames }
}
