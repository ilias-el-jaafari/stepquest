/**
 * Hand-drawn 16×16 sprites as character grids (our own designs). Each
 * character maps to a colour; '.' is transparent.
 */
export type Sprite = { rows: string[]; colors: Record<string, string> }

export const PLAYER_DOWN: Sprite = {
  // A walker in a teal beanie with headphones and a purple jacket.
  rows: [
    '................',
    '.....kkkkkk.....',
    '....kttttttk....',
    '...kttTTTTttk...',
    '...kttttttttk...',
    '..kHkkkkkkkkHk..',
    '..kHksssssskHk..',
    '..kHksEssEskHk..',
    '...kksssssskk...',
    '....kksssskk....',
    '...kppppppppk...',
    '..kspppPPpppsk..',
    '..kskppppppksk..',
    '...kkbbbbbbkk...',
    '....kbbkkbbk....',
    '....kkk..kkk....',
  ],
  colors: {
    k: '#1b1a2e',
    t: '#2fb3a6',
    T: '#8ff0e2',
    H: '#ffd84a',
    s: '#f6c79a',
    E: '#1b1a2e',
    p: '#7b4fc4',
    P: '#b48cf0',
    b: '#3b4a8a',
  },
}

export type Facing = 'down' | 'up' | 'left' | 'right'

const WALKER_COLORS = { ...PLAYER_DOWN.colors, h: '#5a3a2a' }

const DOWN_TOP = PLAYER_DOWN.rows.slice(0, 13)
const UP_TOP = [
  '................',
  '.....kkkkkk.....',
  '....kttttttk....',
  '...kttTTTTttk...',
  '...kttttttttk...',
  '..kHkttttttkHk..',
  '..kHkhhhhhhkHk..',
  '..kHkhhhhhhkHk..',
  '...kkhhhhhhkk...',
  '....kkhhhhkk....',
  '...kpPPPPPPpk...',
  '..kspPPPPPPpsk..',
  '..kskpPPPPpksk..',
]
const LEFT_TOP = [
  '................',
  '.....kkkkkk.....',
  '....kttttttk....',
  '...kTTTttttk....',
  '...kttttttttk...',
  '...kkkkkkkHHk...',
  '..ksssssshkHk...',
  '..ksEssshhkHk...',
  '..ksssssshkk....',
  '...kksssskk.....',
  '....kppppppk....',
  '....kpPPpppk....',
  '....ksspppk.....',
]
// Legs for the front and back views: standing, left foot forward, right foot forward.
const FRONT_LEGS = [
  ['...kkbbbbbbkk...', '....kbbkkbbk....', '....kkk..kkk....'],
  ['...kkbbbbbbkk...', '....kbbk.kkk....', '....kkk.........'],
  ['...kkbbbbbbkk...', '....kkk.kbbk....', '.........kkk....'],
]
// Side view: standing, then legs apart (one stride each way).
const SIDE_LEGS = [
  ['....kbbbbbbk....', '.....kbbbbk.....', '.....kkkkkk.....'],
  ['....kbbbbbbk....', '...kbbk..kbbk...', '...kkk....kkk...'],
  ['....kbbbbbbk....', '....kbbkkbbk....', '....kkk..kkk....'],
]

function mirror(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''))
}

function frames(top: readonly string[], legs: readonly (readonly string[])[]): Sprite[] {
  return legs.map((l) => ({ rows: [...top, ...l], colors: WALKER_COLORS }))
}

/** The walker in four directions, three frames each (stand, step, other step). Original design. */
export const WALKER: Record<Facing, Sprite[]> = {
  down: frames(DOWN_TOP, FRONT_LEGS),
  up: frames(UP_TOP, FRONT_LEGS),
  left: frames(LEFT_TOP, SIDE_LEGS),
  right: frames(mirror(LEFT_TOP), SIDE_LEGS.map(mirror)),
}

/**
 * Which way the walker faces after moving by (dx, dy) in map units (y grows
 * southwards). Tiny moves keep the previous facing; near-diagonals keep the
 * current axis to avoid flicker.
 */
export function facingFrom(dx: number, dy: number, previous: Facing = 'down', minMove = 0.05): Facing {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < minMove) return previous
  const horizontalNow = previous === 'left' || previous === 'right'
  const bias = 1.25
  const horizontal = horizontalNow ? ax * bias >= ay : ax > ay * bias
  if (horizontal) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

/** Walk-cycle frame for a time in ms: stand, step, stand, other step. */
export function walkFrame(ms: number, moving: boolean, frameMs = 140): number {
  if (!moving) return 0
  return [0, 1, 0, 2][Math.floor(ms / frameMs) % 4] ?? 0
}

export const CHECKPOINT: Sprite = {
  // A spinning "step gem" on a small plinth.
  rows: [
    '................',
    '.......kk.......',
    '......kYYk......',
    '.....kYWYYk.....',
    '....kYWYYYOk....',
    '...kYYYYYYOOk...',
    '....kOYYYOOk....',
    '.....kOYOOk.....',
    '......kOOk......',
    '.......kk.......',
    '................',
    '.....kkkkkk.....',
    '....kggggggk....',
    '....kGGGGGGk....',
    '.....kkkkkk.....',
    '................',
  ],
  colors: { k: '#1b1a2e', Y: '#ffd84a', W: '#fffbe0', O: '#e88a2a', g: '#9fd8ff', G: '#4a8ff0' },
}

export const FINISH_FLAG: Sprite = {
  rows: [
    '................',
    '...kk...........',
    '...kwkkkkkkkk...',
    '...kwKwKwKwKk...',
    '...kwwKwKwKwk...',
    '...kwKwKwKwKk...',
    '...kwwKwKwKwk...',
    '...kwkkkkkkkk...',
    '...kwk..........',
    '...kwk..........',
    '...kwk..........',
    '...kwk..........',
    '..kkwkk.........',
    '.kggggggk.......',
    '..kkkkkk........',
    '................',
  ],
  colors: { k: '#1b1a2e', w: '#fbf7ec', K: '#1b1a2e', g: '#5eaf48' },
}

export const START_MAT: Sprite = {
  rows: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '.krrrrrrrrrrrrk.',
    '.krRRRRRRRRRRrk.',
    '.krRrrrrrrrrRrk.',
    '.krRRRRRRRRRRrk.',
    '.krrrrrrrrrrrrk.',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  colors: { k: '#1b1a2e', r: '#ff4f6d', R: '#ffd84a' },
}

export function paintSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, scale = 1): void {
  sprite.rows.forEach((row, sy) => {
    for (let sx = 0; sx < row.length; sx++) {
      const color = sprite.colors[row[sx] ?? '.']
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x + sx * scale, y + sy * scale, scale, scale)
    }
  })
}

/** Rows must be 16 characters so sprites line up with tiles. */
export function spriteIsValid(sprite: Sprite): boolean {
  return sprite.rows.length === 16 && sprite.rows.every((r) => r.length === 16 && [...r].every((c) => c === '.' || c in sprite.colors))
}
