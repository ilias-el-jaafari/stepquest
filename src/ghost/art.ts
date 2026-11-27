import type { Sprite } from '../render/sprites.ts'

/**
 * The guide ghost: a small rounded sheet with a wavy hem, two eyes, a blush and a tiny lantern.
 * Our own 16×16 design, drawn as character grids like every other sprite. The ghost faces the viewer and
 * holds the lantern on its right; the renderer mirrors it when it walks left.
 *
 * Keys: K ink outline and eyes, W sheet, H highlight, S shade, B blush, L lantern light.
 */
export const GHOST_COLORS = { K: '#1b1a2e', W: '#e9e4ff', H: '#ffffff', S: '#bdb2ee', B: '#ff8fa3', L: '#ffd84a' } as const

/** Head, face and body, rows 0 to 11 (the hem is added per frame). */
const BODY = [
  '......KKK.......',
  '....KKWWWKK.....',
  '...KWHHWWWWK....',
  '..KWWWWWWWWWK...',
  '..KWKKWWWKKWK...',
  '..KWKKWWWKKWK.K.',
  '..KBBWWKWWBBK.K.',
  '..KWWWWWWWWWK.K.',
  '..KWWWWWWWWWKKKK',
  '..KWWWWWWWWWKKLK',
  '..KSWWWWWWWSKKLK',
  '..KWWWWWWWWWKKKK',
] as const

const HEM_A = ['..KWWWWWWWWWK...', '..KWWKWWWKWWK...', '...KK.KKK.KK....', '................'] as const
const HEM_B = ['..KWWWWWWWWWK...', '..KWKWWWWWKWK...', '...K.KKKKK.K....', '................'] as const

function frame(rows: readonly string[], patch: readonly (readonly [number, number, string])[] = []): Sprite {
  const grid = rows.map((r) => [...r])
  for (const [y, x, ch] of patch) grid[y]![x] = ch
  return { rows: grid.map((r) => r.join('')), colors: { ...GHOST_COLORS } }
}

const A = [...BODY, ...HEM_A]
const B = [...BODY, ...HEM_B]

/** Float: the hem swaps between two waves. */
export const GHOST_FLOAT: readonly Sprite[] = [frame(A), frame(B)]

/** Happy: eyes bent into little arches, a wide smile (the finish). */
export const GHOST_HAPPY: Sprite = frame(B, [
  [4, 4, 'W'], [4, 5, 'K'], [4, 9, 'K'], [4, 10, 'W'],
  [5, 4, 'K'], [5, 5, 'W'], [5, 9, 'W'], [5, 10, 'K'],
  [6, 6, 'W'], [6, 7, 'K'], [6, 8, 'K'], [7, 7, 'W'],
])

/** Boo: eyes wide, mouth open (the friendly scare). */
export const GHOST_BOO: Sprite = frame(A, [
  [6, 7, 'K'], [7, 6, 'K'], [7, 7, 'K'], [7, 8, 'K'], [8, 7, 'K'],
])

/** Every frame, for the sprite cache and the tests. */
export const GHOST_FRAMES: readonly Sprite[] = [...GHOST_FLOAT, GHOST_HAPPY, GHOST_BOO]

export type GhostPose = 'float' | 'happy' | 'boo'

/** The sprite for a pose; `phase` (0 or 1) picks the hem wave of the float pose. */
export function ghostSprite(pose: GhostPose, phase = 0): Sprite {
  if (pose === 'happy') return GHOST_HAPPY
  if (pose === 'boo') return GHOST_BOO
  return GHOST_FLOAT[phase & 1]!
}

/** Float animation: the hem wave changes every 320 ms. */
export function ghostPhase(ms: number): number {
  return Math.floor(ms / 320) & 1
}

/** The ghost bobs one art pixel up and down in four steps (0 when motion is reduced). */
export function ghostBob(ms: number, reduced: boolean): number {
  if (reduced) return 0
  return [0, 1, 1, 0][Math.floor(ms / 240) & 3]!
}
