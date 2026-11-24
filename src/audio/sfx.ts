/**
 * Short sound effects as note lists, played on pulse and noise voices.
 * Times and lengths are in seconds.
 */
export type SfxNote = { hz: number; at: number; len: number; wave: 'pulse25' | 'pulse50' | 'triangle' | 'noise'; slideTo?: number; gain?: number }

/** Two-note sparkle with a rising tail. */
export const GEM: SfxNote[] = [
  { hz: 1046.5, at: 0, len: 0.06, wave: 'pulse25' },
  { hz: 1568, at: 0.06, len: 0.07, wave: 'pulse25' },
  { hz: 2093, at: 0.13, len: 0.16, wave: 'pulse25', gain: 0.8 },
  { hz: 2637, at: 0.13, len: 0.16, wave: 'pulse50', gain: 0.25 },
]

/** Last gem before the flag: same sparkle, an octave of extra glitter. */
export const GEM_LAST: SfxNote[] = [...GEM, { hz: 3136, at: 0.29, len: 0.18, wave: 'pulse25', gain: 0.6 }]

/** Victory jingle: a rising arpeggio, a held chord and a drum hit. */
export const FINISH: SfxNote[] = [
  { hz: 523.25, at: 0, len: 0.11, wave: 'pulse25' },
  { hz: 659.25, at: 0.11, len: 0.11, wave: 'pulse25' },
  { hz: 783.99, at: 0.22, len: 0.11, wave: 'pulse25' },
  { hz: 1046.5, at: 0.33, len: 0.3, wave: 'pulse25' },
  { hz: 932.33, at: 0.66, len: 0.11, wave: 'pulse25' },
  { hz: 1046.5, at: 0.77, len: 0.11, wave: 'pulse25' },
  { hz: 1174.66, at: 0.88, len: 0.7, wave: 'pulse25' },
  { hz: 698.46, at: 0.88, len: 0.7, wave: 'pulse50', gain: 0.35 },
  { hz: 130.81, at: 0, len: 0.33, wave: 'triangle', gain: 0.9 },
  { hz: 174.61, at: 0.33, len: 0.33, wave: 'triangle', gain: 0.9 },
  { hz: 196, at: 0.66, len: 0.92, wave: 'triangle', gain: 0.9 },
  { hz: 0, at: 0.88, len: 0.25, wave: 'noise', gain: 0.5 },
]

/** Summary fanfare: three quick pickups, a rising leap and a held, bright chord with a drum roll. */
export const FANFARE: SfxNote[] = [
  { hz: 392, at: 0, len: 0.09, wave: 'pulse25' },
  { hz: 392, at: 0.11, len: 0.09, wave: 'pulse25' },
  { hz: 392, at: 0.22, len: 0.09, wave: 'pulse25' },
  { hz: 523.25, at: 0.33, len: 0.22, wave: 'pulse25' },
  { hz: 659.25, at: 0.58, len: 0.12, wave: 'pulse25' },
  { hz: 783.99, at: 0.72, len: 0.12, wave: 'pulse25' },
  { hz: 1046.5, at: 0.86, len: 0.6, wave: 'pulse25' },
  { hz: 659.25, at: 0.86, len: 0.6, wave: 'pulse50', gain: 0.35 },
  { hz: 196, at: 0, len: 0.33, wave: 'triangle', gain: 0.9 },
  { hz: 261.63, at: 0.33, len: 0.5, wave: 'triangle', gain: 0.9 },
  { hz: 130.81, at: 0.86, len: 0.6, wave: 'triangle', gain: 0.9 },
  { hz: 0, at: 0.86, len: 0.12, wave: 'noise', gain: 0.4 },
]

/** Quest paused: a soft two-note settle. */
export const REST: SfxNote[] = [
  { hz: 659.25, at: 0, len: 0.16, wave: 'pulse50', gain: 0.5 },
  { hz: 523.25, at: 0.18, len: 0.3, wave: 'pulse50', gain: 0.5 },
  { hz: 261.63, at: 0, len: 0.48, wave: 'triangle', gain: 0.6 },
]

/** Soft "bonk" when the walker leaves the route. */
export const OFF_ROUTE: SfxNote[] = [
  { hz: 392, at: 0, len: 0.09, wave: 'pulse50', gain: 0.6 },
  { hz: 311.13, at: 0.1, len: 0.16, wave: 'pulse50', gain: 0.6, slideTo: 261.63 },
]

/** A short, quiet button click. */
export const CLICK: SfxNote[] = [{ hz: 1760, at: 0, len: 0.022, wave: 'pulse50', gain: 0.3, slideTo: 1320 }]

export const SFX = { gem: GEM, gemLast: GEM_LAST, finish: FINISH, fanfare: FANFARE, rest: REST, offRoute: OFF_ROUTE, click: CLICK } as const
export type SfxName = keyof typeof SFX

/** Total length of an effect in seconds. */
export function sfxDuration(notes: readonly SfxNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.at + n.len), 0)
}
