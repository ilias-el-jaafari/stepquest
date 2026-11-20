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
