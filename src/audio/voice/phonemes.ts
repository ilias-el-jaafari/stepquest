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
  /** Formant targets F1–F3 (Hz). Stops and /h/ borrow the next sound's. */
  f: Formants
  /** Diphthongs glide to these formants by the end. */
  to?: Formants
  /** Default length in milliseconds. */
  dur: number
  /** Amplitude of the voiced (buzz) source, 0–1. */
  voice: number
  /** Amplitude of the hiss source, 0–1. */
  noise: number
  /** Centre and bandwidth of the hiss filter for fricatives and bursts (Hz). */
  noiseHz?: number
  noiseBw?: number
}

const V = (f1: number, f2: number, f3: number, dur: number, to?: Formants): Phoneme => ({ kind: 'vowel', f: [f1, f2, f3], dur, voice: 1, noise: 0, to })
const fric = (noiseHz: number, noiseBw: number, noise: number, voice: number, dur: number): Phoneme => ({ kind: 'fricative', f: [400, 1600, 2600], dur, voice, noise, noiseHz, noiseBw })
const stop = (noiseHz: number, noiseBw: number, voiced: boolean, dur: number): Phoneme => ({ kind: 'stop', f: [400, 1600, 2600], dur, voice: voiced ? 0.3 : 0, noise: voiced ? 0.35 : 0.6, noiseHz, noiseBw })

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
  M: { kind: 'nasal', f: [280, 1000, 2200], dur: 70, voice: 0.6, noise: 0 },
  N: { kind: 'nasal', f: [280, 1600, 2600], dur: 65, voice: 0.6, noise: 0 },
  NG: { kind: 'nasal', f: [280, 2200, 2700], dur: 70, voice: 0.6, noise: 0 },
  NY: { kind: 'nasal', f: [280, 2050, 2850], dur: 80, voice: 0.6, noise: 0 },
  // Fricatives.
  F: fric(6200, 4500, 0.22, 0, 90),
  V: fric(5800, 4500, 0.12, 0.45, 60),
  TH: fric(6000, 5000, 0.2, 0, 85),
  DH: fric(5000, 4000, 0.1, 0.45, 45),
  S: fric(5600, 2200, 0.5, 0, 100),
  Z: fric(5200, 2400, 0.3, 0.4, 80),
  SH: fric(2800, 1800, 0.5, 0, 100),
  ZH: fric(2700, 1800, 0.3, 0.4, 80),
  X: fric(1600, 1600, 0.6, 0, 95),
  HH: { kind: 'aspirate', f: [500, 1500, 2500], dur: 60, voice: 0, noise: 0.35 },
  // Stops: closure, then a burst (and the voice bar for voiced ones).
  P: stop(1200, 2000, false, 80),
  B: stop(1000, 1800, true, 60),
  T: stop(4200, 3000, false, 75),
  D: stop(3800, 3000, true, 55),
  K: stop(2100, 1500, false, 85),
  G: stop(2000, 1500, true, 65),
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
