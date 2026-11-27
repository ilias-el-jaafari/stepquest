/**
 * Shared pieces of the chiptune: event types, note maths and the level budget.
 * The tune itself is composed in `theme.ts`, which is loaded lazily.
 */

export type Drum = 'kick' | 'snare' | 'hat'
export type NoteEvent = { midi: number; steps: number }
export type StepEvents = { lead?: NoteEvent; arp?: NoteEvent; bass?: NoteEvent; drum?: Drum }

export const STEPS_PER_BAR = 16

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** First step of the next bar (or this one, if already on a bar line): where tunes can switch without a jolt. */
export function nextBarStep(step: number): number {
  return Math.ceil(step / STEPS_PER_BAR) * STEPS_PER_BAR
}

/** The calm planning-screen arrangement: melody and bass, a soft kick, no arpeggio, snare or hi-hat. */
export function calmEvents(ev: StepEvents): StepEvents {
  const out: StepEvents = {}
  if (ev.lead) out.lead = ev.lead
  if (ev.bass) out.bass = ev.bass
  if (ev.drum === 'kick') out.drum = 'kick'
  return out
}

/** Peak gain of each music voice before the music bus. */
export const LEVELS = { lead: 0.08, arp: 0.025, bass: 0.1, kick: 0.12, snare: 0.06, hat: 0.02 } as const

/** The loudest the summed music may be at full sliders (fraction of full scale). */
export const MUSIC_PEAK_CEILING = 0.12
/** Gain of the music bus at a music volume of 100 %. */
export const MUSIC_BUS_MAX = 0.35
