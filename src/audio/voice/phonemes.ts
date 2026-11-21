/**
 * Phoneme table for the formant voice. Symbols follow ARPAbet for English,
 * plus a few Spanish sounds (pure vowels A E I O U, tap RX, trill RR, ñ NY,
 * jota X). Formant frequencies are textbook averages for an adult voice
 * (acoustic phonetics), tuned by ear for a clear, slightly robotic sound.
 */

export type PhonemeKind = 'vowel' | 'glide' | 'liquid' | 'nasal' | 'fricative' | 'aspirate' | 'stop' | 'pause'

export type Formants = readonly [number, number, number]

export type Phoneme = {
  kind: PhonemeKind
  /**
   * Formant targets F1–F3 (Hz). For consonants these are the "locus" the
   * neighbouring vowels bend towards. /h/ and pauses borrow their neighbours'.
   */
  f: Formants
  /** Diphthongs glide to these formants by the end. */
  to?: Formants
  /** Default length in milliseconds. */
  dur: number
  /** Amplitude of voicing (the glottal buzz), 0–1. */
  voice: number
  /** Amplitude of frication (fricatives, bursts) or aspiration (/h/), 0–1. */
  noise: number
  /**
   * Shape of the frication noise: gains of the parallel resonators
   * A2…A6 and the flat bypass AB (as in Klatt's cascade/parallel design).
   */
  bank?: Bank
}

/** Gains for the parallel frication resonators: [A2, A3, A4, A5, A6, AB]. */
export type Bank = readonly [number, number, number, number, number, number]

/** Klatt-style amplitude in dB (60 = unity) to a linear gain. */
const dB = (v: number) => (v <= 0 ? 0 : 10 ** ((v - 60) / 20))
const bank = (a2: number, a3: number, a4: number, a5: number, a6: number, ab: number): Bank => [dB(a2), dB(a3), dB(a4), dB(a5), dB(a6), dB(ab)]

const V = (f1: number, f2: number, f3: number, dur: number, to?: Formants): Phoneme => ({ kind: 'vowel', f: [f1, f2, f3], dur, voice: 1, noise: 0, to })
const fric = (f: Formants, b: Bank, noise: number, voice: number, dur: number): Phoneme => ({ kind: 'fricative', f, dur, voice, noise, bank: b })
const stop = (f: Formants, b: Bank, voiced: boolean, dur: number): Phoneme => ({ kind: 'stop', f, dur, voice: voiced ? 0.25 : 0, noise: voiced ? 0.3 : 0.9, bank: b })

export const PHONEMES = {
  // English vowels.
  AA: V(730, 1090, 2440, 110),
  AE: V(660, 1720, 2410, 115),
  AH: V(620, 1190, 2390, 85),
  AO: V(570, 840, 2410, 110),
  EH: V(530, 1840, 2480, 90),
  ER: V(490, 1350, 1690, 110),
  IH: V(390, 1990, 2550, 75),
  IY: V(280, 2290, 3010, 100),
  UH: V(440, 1020, 2240, 80),
  UW: V(310, 870, 2240, 105),
  AX: V(500, 1500, 2500, 55),
  // English diphthongs.
  AY: V(720, 1150, 2450, 165, [300, 2200, 2950]),
  EY: V(500, 1900, 2500, 150, [300, 2250, 2950]),
  OW: V(560, 900, 2400, 150, [330, 820, 2300]),
  AW: V(720, 1200, 2450, 165, [340, 850, 2300]),
  OY: V(560, 850, 2400, 170, [320, 2200, 2900]),
  // Spanish vowels: shorter and purer.
  A: V(700, 1250, 2500, 95),
  E: V(450, 1850, 2550, 90),
  I: V(290, 2250, 2950, 85),
  O: V(470, 900, 2450, 95),
  U: V(320, 800, 2350, 85),
  // Glides and liquids.
  W: { kind: 'glide', f: [300, 650, 2200], dur: 60, voice: 0.85, noise: 0 },
  Y: { kind: 'glide', f: [270, 2100, 3000], dur: 60, voice: 0.85, noise: 0 },
  L: { kind: 'liquid', f: [360, 1100, 2700], dur: 65, voice: 0.8, noise: 0 },
  R: { kind: 'liquid', f: [420, 1250, 1600], dur: 70, voice: 0.8, noise: 0 },
  RX: { kind: 'liquid', f: [450, 1400, 2400], dur: 32, voice: 0.55, noise: 0 },
  RR: { kind: 'liquid', f: [450, 1400, 2400], dur: 95, voice: 0.7, noise: 0 },
  // Nasals.
  M: { kind: 'nasal', f: [280, 1000, 2200], dur: 70, voice: 0.5, noise: 0 },
  N: { kind: 'nasal', f: [280, 1600, 2600], dur: 65, voice: 0.5, noise: 0 },
  NG: { kind: 'nasal', f: [280, 2200, 2700], dur: 70, voice: 0.5, noise: 0 },
  NY: { kind: 'nasal', f: [280, 2050, 2850], dur: 80, voice: 0.5, noise: 0 },
  // Fricatives. Spectra after Klatt (1980), table III: /s/ is a high
  // front-cavity resonance, /sh/ lower and wider, /f/ and /th/ nearly flat and weak.
  F: fric([340, 1100, 2080], bank(0, 0, 0, 0, 0, 48), 0.5, 0, 90),
  V: fric([220, 1100, 2080], bank(0, 0, 0, 0, 0, 48), 0.3, 0.55, 60),
  TH: fric([320, 1290, 2540], bank(0, 0, 0, 0, 30, 44), 0.5, 0, 85),
  DH: fric([270, 1290, 2540], bank(0, 0, 0, 0, 30, 44), 0.25, 0.55, 45),
  S: fric([320, 1390, 2530], bank(0, 0, 0, 46, 60, 0), 0.8, 0, 100),
  Z: fric([240, 1390, 2530], bank(0, 0, 0, 46, 60, 0), 0.4, 0.5, 80),
  SH: fric([300, 1840, 2750], bank(0, 62, 55, 50, 46, 0), 0.8, 0, 100),
  ZH: fric([300, 1840, 2750], bank(0, 62, 55, 50, 46, 0), 0.4, 0.5, 80),
  X: fric([320, 1500, 2500], bank(66, 58, 40, 0, 0, 0), 1.2, 0, 100),
  HH: { kind: 'aspirate', f: [500, 1500, 2500], dur: 60, voice: 0, noise: 0.5 },
  // Stops: closure (with a low voice bar for voiced ones), then a burst.
  P: stop([400, 1100, 2150], bank(0, 0, 0, 0, 0, 63), false, 80),
  B: stop([200, 1100, 2150], bank(0, 0, 0, 0, 0, 63), true, 60),
  T: stop([400, 1600, 2600], bank(0, 30, 45, 57, 63, 0), false, 75),
  D: stop([200, 1600, 2600], bank(0, 47, 60, 62, 60, 0), true, 55),
  K: stop([300, 1990, 2850], bank(0, 53, 43, 45, 45, 0), false, 85),
  G: stop([200, 1990, 2850], bank(0, 53, 43, 45, 45, 0), true, 65),
  // Silences: between words, at a comma, at the end of a sentence.
  _: { kind: 'pause', f: [500, 1500, 2500], dur: 20, voice: 0, noise: 0 },
  ',': { kind: 'pause', f: [500, 1500, 2500], dur: 170, voice: 0, noise: 0 },
  '.': { kind: 'pause', f: [500, 1500, 2500], dur: 300, voice: 0, noise: 0 },
} as const satisfies Record<string, Phoneme>

export type PhonemeSymbol = keyof typeof PHONEMES

/** One phoneme in an utterance, with stress for the pitch accent. */
export type Phone = { p: PhonemeSymbol; stress?: boolean; /** Length multiplier. */ len?: number }

export function isPhonemeSymbol(s: string): s is PhonemeSymbol {
  return Object.hasOwn(PHONEMES, s)
}
