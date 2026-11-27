/**
 * Short sound effects as note lists, played on pulse and noise voices.
 * Times and lengths are in seconds.
 */
export type SfxNote = { hz: number; at: number; len: number; wave: 'pulse25' | 'pulse50' | 'triangle' | 'noise'; slideTo?: number; gain?: number }

/** Gem pickup: a short A minor arpeggio, up and held. */
export const GEM: SfxNote[] = [
  { hz: 880, at: 0, len: 0.06, wave: 'pulse25' },
  { hz: 1046.5, at: 0.06, len: 0.06, wave: 'pulse25' },
  { hz: 1318.5, at: 0.12, len: 0.06, wave: 'pulse25' },
  { hz: 1760, at: 0.18, len: 0.2, wave: 'pulse25', gain: 0.9 },
  { hz: 880, at: 0.18, len: 0.2, wave: 'pulse50', gain: 0.2 },
]

/** Last gem before the flag: the same arpeggio with a high bell on top. */
export const GEM_LAST: SfxNote[] = [
  ...GEM,
  { hz: 2093, at: 0.26, len: 0.12, wave: 'pulse25', gain: 0.45 },
  { hz: 2637, at: 0.36, len: 0.24, wave: 'pulse25', gain: 0.45 },
]

/** Wisp's "¡Bu!": a falling two-note wobble over a soft thump, and a little sparkle. Quiet on purpose. */
export const SCARE: SfxNote[] = [
  { hz: 392, at: 0, len: 0.1, wave: 'pulse50', slideTo: 330, gain: 0.5 },
  { hz: 330, at: 0.12, len: 0.16, wave: 'pulse50', slideTo: 262, gain: 0.5 },
  { hz: 98, at: 0, len: 0.22, wave: 'triangle', gain: 0.5 },
  { hz: 1318.5, at: 0.34, len: 0.05, wave: 'pulse25', gain: 0.3 },
  { hz: 1760, at: 0.4, len: 0.12, wave: 'pulse25', gain: 0.3 },
]

/**
 * Finish fanfare (2.65 s): a minor arpeggio up, a whole-tone run, and a landing on a
 * major chord over a walking bass with a soft drum hit.
 */
export const FINISH: SfxNote[] = [
  { hz: 440, at: 0, len: 0.1, wave: 'pulse25' },
  { hz: 523.25, at: 0.12, len: 0.1, wave: 'pulse25' },
  { hz: 659.25, at: 0.24, len: 0.1, wave: 'pulse25' },
  { hz: 880, at: 0.36, len: 0.22, wave: 'pulse25' },
  { hz: 987.77, at: 0.62, len: 0.1, wave: 'pulse25' },
  { hz: 1108.73, at: 0.74, len: 0.1, wave: 'pulse25' },
  { hz: 1244.51, at: 0.86, len: 0.1, wave: 'pulse25' },
  { hz: 1396.91, at: 0.98, len: 0.1, wave: 'pulse25' },
  { hz: 1567.98, at: 1.1, len: 0.1, wave: 'pulse25' },
  { hz: 1760, at: 1.25, len: 1.4, wave: 'pulse25', gain: 0.8 },
  { hz: 1108.73, at: 1.25, len: 1.4, wave: 'pulse50', gain: 0.25 },
  { hz: 1318.5, at: 1.25, len: 1.4, wave: 'pulse50', gain: 0.25 },
  { hz: 110, at: 0, len: 0.5, wave: 'triangle', gain: 0.6 },
  { hz: 87.31, at: 0.5, len: 0.5, wave: 'triangle', gain: 0.6 },
  { hz: 82.41, at: 1, len: 0.25, wave: 'triangle', gain: 0.6 },
  { hz: 110, at: 1.25, len: 1.4, wave: 'triangle', gain: 0.6 },
  { hz: 0, at: 1.25, len: 0.12, wave: 'noise', gain: 0.25 },
]

/** Summary reprise: a short, bright arpeggio that lands on the major chord. */
export const FANFARE: SfxNote[] = [
  { hz: 440, at: 0, len: 0.1, wave: 'pulse25' },
  { hz: 554.37, at: 0.12, len: 0.1, wave: 'pulse25' },
  { hz: 659.25, at: 0.24, len: 0.1, wave: 'pulse25' },
  { hz: 880, at: 0.36, len: 0.8, wave: 'pulse25', gain: 0.8 },
  { hz: 1108.73, at: 0.36, len: 0.8, wave: 'pulse50', gain: 0.25 },
  { hz: 110, at: 0, len: 0.36, wave: 'triangle', gain: 0.6 },
  { hz: 110, at: 0.36, len: 0.8, wave: 'triangle', gain: 0.6 },
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

export const SFX = { gem: GEM, gemLast: GEM_LAST, scare: SCARE, finish: FINISH, fanfare: FANFARE, rest: REST, offRoute: OFF_ROUTE, click: CLICK } as const
export type SfxName = keyof typeof SFX

/** Effects that are jingles: the loop ducks under them. */
export const JINGLES: ReadonlySet<SfxName> = new Set<SfxName>(['gem', 'gemLast', 'scare', 'finish', 'fanfare'])

/** Loudest sum of the note gains sounding at once, times the note level (the peak before the effects and master sliders). */
export const NOTE_LEVEL = 0.22
export function sfxPeak(notes: readonly SfxNote[]): number {
  let peak = 0
  for (const n of notes) {
    // The sum can only grow at a note start.
    const sum = notes.filter((m) => m.at <= n.at && m.at + m.len > n.at).reduce((t, m) => t + (m.gain ?? 1), 0)
    peak = Math.max(peak, sum)
  }
  return peak * NOTE_LEVEL
}

/** Total length of an effect in seconds. */
export function sfxDuration(notes: readonly SfxNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.at + n.len), 0)
}
