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
  bat: '#2e2542',
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
} as const

const C = DECOR

/** Every sprite id; a sprite has one or more frames, named `${id}${frame}` in the atlas. */
export const SPRITE_IDS = ['pumpkin', 'jack', 'jackLit', 'bat', 'web', 'skeleton', 'grave', 'crow', 'candle', 'candleLit', 'lantern', 'lanternLit', 'hat', 'fog', 'glow'] as const
export type SpriteId = (typeof SPRITE_IDS)[number]

function patched(rows: readonly string[], patch: readonly (readonly [number, number, string])[]): string[] {
  const grid = rows.map((r) => [...r])
  for (const [y, x, ch] of patch) grid[y]![x] = ch
  return grid.map((r) => r.join(''))
}

const PUMPKIN_ROWS = ['...ss...', '.dddddd.', 'dohooood', 'dooodood', 'dooodood', 'dooooood', '.dddddd.']
const JACK_ROWS = ['...ss...', '.dddddd.', 'dofoofod', 'dooooood', 'doffffod', 'dooffood', '.dddddd.']
const pumpkinColors = { s: C.stem, d: C.pumpkinShade, o: C.pumpkin, h: C.pumpkinLight }
const jackColors = (face: string) => ({ s: C.stem, d: C.pumpkinShade, o: C.pumpkin, f: face })

const BAT_UP = ['bb.....bb', 'bbb.b.bbb', 'bbbbbbbbb', '.bb.b.bb.', '..b...b..']
const BAT_DOWN = ['....b....', '..bbbbb..', 'bbbbbbbbb', 'bb.bbb.bb', 'b...b...b']

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

const SKELETON = ['..bbbb..', '.bkbbkb.', '.bbbbbb.', '..bkkb..', '.bbbbbb.', '.b.bb.b.', '..bbbb..', '.bb..bb.', '.b....b.', 'bb....bb']

const GRAVES = [
  ['..gg..', '.gggg.', 'gggggg', 'ggcggg', 'gcccgg', 'ggcggg', 'gggggg', 'dddddd'],
  ['gggggg', 'gggggg', 'gcccgg', 'gggggg', 'gcccgg', 'gggggg', 'gggggg', 'dddddd'],
  ['..gg..', '..gg..', 'gggggg', 'gggggg', '..gg..', '..gg..', '..gg..', 'mddddm'],
]
const graveColors = { g: C.stone, d: C.stoneShade, c: C.stoneMark, m: C.moss }

const CROW = ['..kkk...', '.kkwkkyy', '.kkkkk..', 'kkkkkkk.', '.kkkkk..', '..y.y...']
const CANDLE = ['.f..', '.F..', '.k..', '.ww.', '.ww.', '.ww.', 'dddd']
const CANDLE_OFF = patched(CANDLE, [[0, 1, '.'], [1, 1, '.']])
const LANTERN = ['..k..', '.rrr.', 'rRyRr', 'rRyRr', 'rRyRr', '.rrr.', '..k..']
const HAT = ['.....pp.', '....ppp.', '...pppp.', '...bbbb.', '..pppppp', 'pppppppp']
const FOG = ['....ffff........', '..ffffffffff....', 'ffffffffffffffff', '..ffffffffff.ff.', '......ffff......']

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
  jack: [sprite(JACK_ROWS, jackColors(C.faceUnlit))],
  jackLit: [sprite(JACK_ROWS, jackColors(C.faceLit))],
  bat: [sprite(BAT_UP, { b: C.bat }), sprite(BAT_DOWN, { b: C.bat })],
  web: [0, 1, 2, 3].map((c) => sprite(webCorner(c), { w: C.web })),
  // Sitting skeleton; frame 1 waves a raised right arm.
  skeleton: [
    sprite(patched(SKELETON, [[3, 7, 'b'], [4, 7, 'b'], [5, 6, '.']]), { b: C.bone, k: C.ink }),
    sprite(patched(SKELETON, [[2, 7, 'b'], [3, 7, 'b'], [4, 6, 'b'], [5, 6, '.']]), { b: C.bone, k: C.ink }),
  ],
  grave: GRAVES.map((g) => sprite(g, graveColors)),
  crow: [sprite(CROW, { k: C.crow, w: C.crowSheen, y: C.beak })],
  candle: [sprite(CANDLE_OFF, { k: C.ink, w: C.wax, d: C.stoneShade })],
  candleLit: [sprite(CANDLE, { f: C.flameCore, F: C.flame, k: C.ink, w: C.wax, d: C.stoneShade })],
  lantern: [sprite(LANTERN, { k: C.ink, r: C.lanternDark, R: C.lanternDark, y: C.lanternOff })],
  lanternLit: [sprite(LANTERN, { k: C.ink, r: C.lanternRed, R: C.lanternDark, y: C.faceLit })],
  hat: [sprite(HAT, { p: C.hat, b: C.hatBand })],
  fog: [sprite(FOG, { f: C.fog })],
  glow: [sprite(glowRows(), { a: 'rgba(255,162,60,0.10)', b: 'rgba(255,162,60,0.22)', c: 'rgba(255,200,110,0.40)' })],
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
