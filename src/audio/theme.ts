/**
 * "Mist Over the Lamp-posts": the quest loop, written by hand for this app.
 * Sixteen bars of sixteen steps (4/4, one step = a sixteenth note) in four phrases:
 *
 *   bars 1-4   creeping minor motif (tip-toe arpeggio with a raised-seventh wink)
 *   bars 5-8   its answer
 *   bars 9-12  whole-tone wander (A, then B-flat), no snare
 *   bars 13-16 cute resolution that breathes out before the loop restarts
 *
 * Nothing here is sampled, generated or taken from another piece. This
 * module is loaded lazily, the first time music is audible.
 */
import { STEPS_PER_BAR, type StepEvents } from './chiptune.ts'

export const BARS = 16
export const STEPS_PER_LOOP = BARS * STEPS_PER_BAR
/** Semitone shift of the three keys (A, G and C minor) picked by the quest seed. */
export const THEME_KEYS = [0, -2, 3] as const

/** [onset step, MIDI note, length in steps] */
type Line = readonly (readonly [number, number, number])[]

// Pitch names used below (MIDI): A4 69, B4 71, C5 72, D5 74, E5 76, F5 77, G5 79, A5 81.
const LEAD: readonly Line[] = [
  // Phrase A: the creeping motif.
  [[0, 69, 2], [3, 72, 1], [4, 76, 3], [8, 75, 1], [9, 76, 1], [10, 72, 2], [12, 69, 4]],
  [[0, 69, 2], [3, 72, 1], [4, 76, 3], [8, 79, 2], [10, 78, 2], [12, 76, 4]],
  [[0, 74, 2], [3, 77, 1], [4, 81, 3], [8, 80, 1], [9, 81, 1], [10, 77, 2], [12, 74, 4]],
  [[0, 76, 2], [3, 80, 1], [4, 83, 3], [8, 80, 2], [10, 76, 2], [12, 76, 4]],
  // Phrase A': the answer.
  [[0, 69, 2], [3, 72, 1], [4, 76, 3], [8, 75, 1], [9, 76, 1], [10, 72, 2], [12, 69, 4]],
  [[0, 69, 2], [3, 72, 1], [4, 76, 2], [6, 79, 2], [8, 81, 4], [12, 79, 2], [14, 76, 2]],
  [[0, 77, 2], [3, 81, 1], [4, 84, 3], [8, 81, 2], [10, 77, 2], [12, 72, 4]],
  [[0, 76, 2], [2, 75, 2], [4, 76, 2], [6, 71, 2], [8, 68, 4], [12, 71, 4]],
  // Phrase B: the whole-tone wander.
  [[0, 69, 2], [2, 71, 2], [4, 73, 2], [6, 75, 2], [8, 77, 2], [10, 79, 2], [12, 81, 4]],
  [[0, 81, 3], [4, 77, 2], [6, 75, 2], [8, 73, 3], [12, 71, 2], [14, 69, 2]],
  [[0, 70, 2], [2, 72, 2], [4, 74, 2], [6, 76, 2], [8, 78, 2], [10, 80, 2], [12, 82, 4]],
  [[0, 82, 3], [4, 78, 2], [6, 76, 2], [8, 74, 3], [12, 72, 2], [14, 68, 2]],
  // Phrase C: the cute resolution.
  [[0, 76, 2], [2, 76, 1], [3, 72, 1], [4, 76, 2], [6, 81, 2], [8, 79, 2], [10, 76, 2], [12, 72, 4]],
  [[0, 77, 2], [2, 77, 1], [3, 72, 1], [4, 77, 2], [6, 81, 2], [8, 84, 2], [10, 81, 2], [12, 77, 4]],
  [[0, 74, 2], [3, 77, 1], [4, 81, 2], [6, 80, 2], [8, 76, 2], [10, 80, 2], [12, 83, 4]],
  [[0, 81, 3], [4, 76, 2], [6, 72, 2], [8, 69, 6]],
]

/** Bass root (MIDI) per bar: Am Am Dm E | Am Am F E | A A B♭ B♭ | Am F E Am. */
const BASS_ROOT = [45, 45, 50, 52, 45, 45, 53, 52, 45, 45, 46, 46, 45, 53, 52, 45] as const

/** Arpeggio chord tones (MIDI, one octave above the bass register) per bar. */
const AM = [57, 60, 64] as const
const DM = [62, 65, 69] as const
const E = [56, 59, 64] as const
const F = [60, 65, 69] as const
const A_WT = [57, 61, 65] as const // augmented, from the whole-tone scale of A
const BB_WT = [58, 62, 66] as const
const CHORDS: readonly (readonly [number, number, number])[] = [AM, AM, DM, E, AM, AM, F, E, A_WT, A_WT, BB_WT, BB_WT, AM, F, E, AM]

/** Whole-tone bars: no snare, so they float. */
const WANDER = (bar: number) => bar >= 8 && bar <= 11

function buildLoop(): StepEvents[] {
  const steps: StepEvents[] = Array.from({ length: STEPS_PER_LOOP }, () => ({}))
  for (let bar = 0; bar < BARS; bar++) {
    const base = bar * STEPS_PER_BAR
    for (const [onset, midi, len] of LEAD[bar]!) steps[base + onset]!.lead = { midi, steps: len }
    const tones = CHORDS[bar]!
    const order = [0, 1, 2, 1]
    for (let s = 0; s < STEPS_PER_BAR; s += 2) steps[base + s]!.arp = { midi: tones[order[(s / 2) % 4]!]! + 12, steps: 1 }
    const root = BASS_ROOT[bar]!
    for (const [onset, midi, len] of [[0, root, 3], [4, root + 12, 2], [8, root, 3], [12, root + 12, 2]] as const) steps[base + onset]!.bass = { midi, steps: len }
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const ev = steps[base + s]!
      if (s === 0 || s === 8) ev.drum = 'kick'
      else if ((s === 4 || s === 12) && !WANDER(bar)) ev.drum = 'snare'
      else if (s % 4 === 2 && (!WANDER(bar) || s === 6 || s === 14)) ev.drum = 'hat'
    }
  }
  // The last step of the loop turns the page with a tiny snare.
  steps[STEPS_PER_LOOP - 1]!.drum = 'snare'
  return steps
}

const LOOP = buildLoop()

/** The semitone shift for a quest seed. */
export function keyFor(seed: number): number {
  return THEME_KEYS[((Math.trunc(seed) % THEME_KEYS.length) + THEME_KEYS.length) % THEME_KEYS.length]!
}

/** The loop in the key of a seed (the same notes shifted); steps past the end start the loop again. */
export function themeLoop(seed: number): StepEvents[] {
  const shift = keyFor(seed)
  const move = (n: { midi: number; steps: number } | undefined) => (n ? { midi: n.midi + shift, steps: n.steps } : undefined)
  return LOOP.map((ev) => {
    const out: StepEvents = {}
    const lead = move(ev.lead)
    const arp = move(ev.arp)
    const bass = move(ev.bass)
    if (lead) out.lead = lead
    if (arp) out.arp = arp
    if (bass) out.bass = bass
    if (ev.drum) out.drum = ev.drum
    return out
  })
}

const cache = new Map<number, StepEvents[]>()

/** What plays at an absolute step, in the key of the seed. Pure; the loop is `step mod 256`. */
export function themeEventsAt(seed: number, step: number): StepEvents {
  const shift = keyFor(seed)
  let loop = cache.get(shift)
  if (!loop) {
    loop = themeLoop(seed)
    cache.set(shift, loop)
  }
  return loop[((step % STEPS_PER_LOOP) + STEPS_PER_LOOP) % STEPS_PER_LOOP]!
}
