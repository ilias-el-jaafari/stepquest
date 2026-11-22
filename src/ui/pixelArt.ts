/**
 * Tab icons drawn as 12×12 pixel grids (original designs). One letter per
 * pixel: k = outline, a/b/c = fills, . = transparent.
 */
export type Icon = { rows: readonly string[]; colors: Record<string, string> }

const INK = '#1b1a2e'

export const ICONS = {
  map: {
    rows: [
      '............',
      '.kkkk.kkkk..',
      'kggggkbbbbk.',
      'kgggkbbbbbk.',
      'kggkbbrrbbk.',
      'kgkbbrbbrbbk',
      'kkbbbbrrbbbk',
      'kbbbbbbrbbgk',
      'kbbbbbrbbggk',
      'kbbbbrbbgggk',
      '.kkkk.kkkkk.',
      '............',
    ],
    colors: { k: INK, g: '#5eaf48', b: '#ecc98f', r: '#ff4f6d' },
  },
  bag: {
    rows: [
      '....kkkk....',
      '...k....k...',
      '..kkkkkkkk..',
      '.kbbbbbbbbk.',
      'kbbbbbbbbbbk',
      'kbkkkkkkkkbk',
      'kbkccccccKbk',
      'kbkccyyccKbk',
      'kbkkkkkkkkbk',
      'kbbbbbbbbbbk',
      'kddddddddddk',
      '.kkkkkkkkkk.',
    ],
    colors: { k: INK, b: '#c98a4e', d: '#94602f', c: '#e8b06c', K: '#94602f', y: '#ffd84a' },
  },
  hero: {
    rows: [
      '...kkkkkk...',
      '..kttttttk..',
      '..kttttttk..',
      '..kssssssk..',
      '..kskssksk..',
      '..kssssssk..',
      '...kkkkkk...',
      '..kppppppk..',
      '.kppppppppk.',
      '.kppppppppk.',
      '.kkkkkkkkkk.',
      '............',
    ],
    colors: { k: INK, t: '#2fb3a6', s: '#f6c79a', p: '#7b4fc4' },
  },
  settings: {
    rows: [
      '.....kk.....',
      '..k.kggk.k..',
      '.kgkkggkkgk.',
      '..kgggggggk.',
      '.kkggkkkggkk',
      'kgggk..kgggk',
      'kgggk..kgggk',
      '.kkggkkkggkk',
      '..kgggggggk.',
      '.kgkkggkkgk.',
      '..k.kggk.k..',
      '.....kk.....',
    ],
    colors: { k: INK, g: '#a3afc9' },
  },
  locate: {
    rows: [
      '.....kk.....',
      '.....kk.....',
      '...kkkkkk...',
      '..k..kk..k..',
      '.k...rr...k.',
      'kkkkrrrrkkkk',
      'kkkkrrrrkkkk',
      '.k...rr...k.',
      '..k..kk..k..',
      '...kkkkkk...',
      '.....kk.....',
      '.....kk.....',
    ],
    colors: { k: INK, r: '#ff4f6d' },
  },
} satisfies Record<string, Icon>

