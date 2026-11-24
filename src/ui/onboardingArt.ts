import type { Icon } from './pixelArt.ts'

/** Small illustrations for the three onboarding screens (original, 16×11 pixel grids). */
const W = 16
const H = 11

function build(fill: string, paint: (set: (x: number, y: number, ch: string) => void) => void): string[] {
  const g = Array.from({ length: H }, () => Array.from({ length: W }, () => fill))
  paint((x, y, ch) => {
    if (x >= 0 && x < W && y >= 0 && y < H) g[y]![x] = ch
  })
  return g.map((r) => r.join(''))
}

const COLORS = {
  g: '#74c45a',
  s: '#ecc98f',
  k: '#1b1a2e',
  r: '#ff4f6d',
  y: '#ffd84a',
  h: '#fff3a8',
  o: '#c99a10',
  n: '#2c3f6b',
  p: '#c3bfd2',
  l: '#46619a',
}

/** 1. Choose your distance: a loop on the grass with a flag. */
const loop: Icon = {
  colors: COLORS,
  rows: build('g', (set) => {
    for (let y = 1; y <= 9; y++) {
      const inset = y === 1 || y === 9 ? 4 : y === 2 || y === 8 ? 3 : 2
      for (let x = inset; x < W - inset; x++) {
        const edge = y === 1 || y === 9 || y === 2 || y === 8
        if (edge || x < inset + 2 || x >= W - inset - 2) set(x, y, 's')
      }
    }
    for (let y = 3; y <= 6; y++) set(7, y, 'k')
    set(8, 3, 'r')
    set(9, 3, 'r')
    set(8, 4, 'r')
    set(9, 4, 'r')
  }),
}

/** 2. Follow the gems: three gems on a rising path, with 1, 2 and 3 dots below. */
const gems: Icon = {
  colors: COLORS,
  rows: build('g', (set) => {
    const stops = [
      { cx: 3, cy: 6 },
      { cx: 8, cy: 5 },
      { cx: 13, cy: 4 },
    ]
    for (let x = 0; x < W; x++) {
      const cy = x < 6 ? 6 : x < 11 ? 5 : 4
      for (let y = cy - 1; y <= cy + 1; y++) set(x, y, 's')
    }
    stops.forEach(({ cx, cy }, i) => {
      set(cx, cy - 1, 'k')
      set(cx - 1, cy, 'k')
      set(cx + 1, cy, 'k')
      set(cx, cy + 1, 'k')
      set(cx, cy, 'y')
      for (let d = 0; d <= i; d++) set(cx - i + d * 2, cy + 3, 'k')
    })
  }),
}

/** 3. Safe by default: a street lamp lighting the pavement at night. */
const lamp: Icon = {
  colors: COLORS,
  rows: build('n', (set) => {
    for (let x = 0; x < W; x++) {
      set(x, 9, 'p')
      set(x, 10, 'l')
    }
    for (let y = 3; y <= 8; y++) set(4, y, 'p')
    for (let x = 4; x <= 8; x++) set(x, 2, 'p')
    set(8, 3, 'y')
    set(7, 3, 'y')
    set(9, 3, 'y')
    set(8, 4, 'h')
    for (let y = 4; y <= 8; y++) for (let x = 8 - (y - 3); x <= 8 + (y - 3); x++) if (!(y === 4 && x === 8)) set(x, y, 'l')
    set(13, 1, 'h')
    set(14, 1, 'h')
    set(13, 2, 'h')
    set(12, 3, 'y')
  }),
}

export const ONBOARDING_ART: readonly Icon[] = [loop, gems, lamp]
