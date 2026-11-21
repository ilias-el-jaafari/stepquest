import type { Locale } from '../../i18n/locale.ts'
import { textToPhones } from './g2p.ts'
import { spellNumbersInText } from './numbers.ts'
import { PHONEMES, type Formants, type Phone, type Phoneme } from './phonemes.ts'

/**
 * A small formant speech synthesizer in the spirit of 1980s talking
 * computers, written from scratch: a glottal pulse train and a hiss source
 * feed a cascade of resonators (one per formant) whose frequencies glide
 * from phoneme to phoneme. The pitch snaps to semitones and the output is
 * reduced to a few bits for the robot timbre. Pure: returns samples.
 */

export type VoiceOptions = {
  sampleRate?: number
  /** Base pitch in Hz (about 110 is a low robot, 180 a higher one). */
  pitch?: number
  /** 1 is normal speed; 1.2 is 20 % faster. */
  speed?: number
  /** Bit depth of the final quantization (0 = off). */
  bits?: number
  /** Snap the pitch to semitones (sing-song robot). */
  quantizePitch?: boolean
  /** Low-pass the output at this frequency (Hz) to keep hiss soft; 0 = off. */
  lowpassHz?: number
  /** Level of all hiss (fricatives, bursts, aspiration), 0–1. */
  noiseLevel?: number
  seed?: number
}

/** Voice "D": smooth robot (no pitch steps, no bit crushing), with soft, low-passed hiss. */
export const VOICE_DEFAULTS: Required<VoiceOptions> = { sampleRate: 22050, pitch: 112, speed: 0.9, bits: 0, quantizePitch: false, lowpassHz: 4200, noiseLevel: 0.5, seed: 1 }

type Segment = {
  ph: Phoneme
  start: number
  length: number
  from: Formants
  f: Formants
  to: Formants
  stress: boolean
  /** Position of this segment in its sentence, 0…1 (for the falling pitch). */
  sentencePos: number
  sentenceEnd: boolean
}

/** Two-pole resonator (a formant): unity gain at 0 Hz, peak at f. */
class Resonator {
  private a = 1
  private b = 0
  private c = 0
  private y1 = 0
  private y2 = 0
  private readonly sr: number
  constructor(sr: number) {
    this.sr = sr
  }
  set(f: number, bw: number) {
    const T = 1 / this.sr
    const freq = Math.min(f, this.sr * 0.45)
    this.c = -Math.exp(-2 * Math.PI * bw * T)
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * freq * T)
    this.a = 1 - this.b - this.c
  }
  run(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpF = (a: Formants, b: Formants, t: number): Formants => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** In-place 2-pole Butterworth low-pass (RBJ biquad). */
export function lowpass(x: Float32Array, cutoff: number, sr: number): void {
  const w = (2 * Math.PI * Math.min(cutoff, sr * 0.45)) / sr
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w)
  const a0 = 1 + alpha
  const b0 = (1 - cos) / 2 / a0
  const b1 = (1 - cos) / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!
    const y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = v
    y2 = y1
    y1 = y
    x[i] = y
  }
}

/** Rosenberg glottal pulse for a phase 0…1. */
function glottal(phase: number): number {
  const open = 0.42
  const close = 0.16
  if (phase < open) return 0.5 * (1 - Math.cos((Math.PI * phase) / open))
  if (phase < open + close) return Math.cos((Math.PI * (phase - open)) / (2 * close))
  return 0
}

function segmentsFor(phones: readonly Phone[], sr: number, speed: number, lead: number): Segment[] {
  const segs: Segment[] = []
  let pos = lead
  let prevEnd: Formants = PHONEMES.AX.f
  // Sentence boundaries for the pitch fall.
  const sentenceOf: number[] = []
  let sentence = 0
  phones.forEach((ph) => {
    sentenceOf.push(sentence)
    if (ph.p === '.') sentence++
  })
  const sentenceLen = new Map<number, number>()
  const sentenceStart = new Map<number, number>()
  phones.forEach((_ph, i) => {
    const s = sentenceOf[i]!
    if (!sentenceStart.has(s)) sentenceStart.set(s, i)
    sentenceLen.set(s, (sentenceLen.get(s) ?? 0) + 1)
  })
  phones.forEach((phone, i) => {
    const ph: Phoneme = PHONEMES[phone.p]
    const length = Math.max(1, Math.round(((ph.dur * (phone.len ?? 1)) / speed / 1000) * sr))
    let f = ph.f
    if (ph.kind === 'stop' || ph.kind === 'aspirate' || ph.kind === 'pause') {
      // Borrow the formants of the next sounding phoneme (the consonant "locus").
      const next = phones.slice(i + 1).find((p) => PHONEMES[p.p].kind !== 'pause' && PHONEMES[p.p].kind !== 'stop')
      f = next ? PHONEMES[next.p].f : prevEnd
      if (ph.kind === 'pause') f = prevEnd
    }
    const to = ph.to ?? f
    const s = sentenceOf[i]!
    const idx = i - (sentenceStart.get(s) ?? 0)
    const n = sentenceLen.get(s) ?? 1
    const nextIsEnd = phones.slice(i + 1).findIndex((p) => p.p === '.' || p.p === ',')
    segs.push({ ph, start: pos, length, from: prevEnd, f, to, stress: !!phone.stress, sentencePos: n > 1 ? idx / (n - 1) : 0, sentenceEnd: nextIsEnd >= 0 && nextIsEnd <= 2 || i >= phones.length - 2 })
    prevEnd = to
    pos += length
  })
  return segs
}

export function renderPhones(phones: readonly Phone[], options: VoiceOptions = {}): Float32Array {
  const o = { ...VOICE_DEFAULTS, ...options }
  const sr = o.sampleRate
  // A short silence first: Bluetooth headsets and speech start-up often swallow the first syllable.
  const lead = Math.round(0.09 * sr)
  const segs = segmentsFor(phones, sr, o.speed, lead)
  const tail = Math.round(0.04 * sr)
  const total = (segs.length ? segs[segs.length - 1]!.start + segs[segs.length - 1]!.length : 0) + tail
  const out = new Float32Array(total)
  if (!segs.length) return out

  const r1 = new Resonator(sr)
  const r2 = new Resonator(sr)
  const r3 = new Resonator(sr)
  const r4 = new Resonator(sr)
  r4.set(3500, 300)
  const rn = new Resonator(sr)
  let seed = o.seed >>> 0 || 1
  // White noise, then a one-pole low-pass (about 3 kHz) so the hiss is never a shrill TV static.
  const kNoise = 1 - Math.exp((-2 * Math.PI * 3000) / sr)
  let lpNoise = 0
  const white = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2147483648 - 1
  }
  const noise = () => {
    lpNoise += (white() - lpNoise) * kNoise
    return lpNoise * 1.8
  }
  const smooth = (ms: number) => 1 - Math.exp(-1 / ((ms / 1000) * sr))
  const kAmp = smooth(5)
  // Hiss fades in and out more slowly than the voice, so consonants never click or spit.
  const kNoiseAmp = smooth(12)
  const kPitch = smooth(30)
  let aVoice = 0
  let aNoise = 0
  let aAsp = 0
  let f0 = o.pitch
  let phase = 0
  let prevG = 0
  let si = 0
  const BLOCK = 32
  let curNoiseHz = 0

  for (let n = 0; n < total; n++) {
    while (si < segs.length - 1 && n >= segs[si]!.start + segs[si]!.length) si++
    const seg = segs[si]!
    if (n < seg.start) continue
    const t = Math.min(1, Math.max(0, (n - seg.start) / seg.length))
    const ph = seg.ph
    const ended = n >= seg.start + seg.length

    if (n % BLOCK === 0) {
      const trans = Math.min(0.4, (0.03 * sr) / seg.length)
      let F: Formants
      if (t < trans) F = lerpF(seg.from, seg.f, t / trans)
      else F = lerpF(seg.f, seg.to, (t - trans) / (1 - trans || 1))
      const nasal = ph.kind === 'nasal'
      // Nasals: a low murmur, upper formants damped (wide bandwidths).
      r1.set(F[0], nasal ? 100 : 75)
      r2.set(F[1], nasal ? 380 : 100)
      r3.set(F[2], nasal ? 450 : 150)
      if (ph.noiseHz && ph.noiseHz !== curNoiseHz) {
        rn.set(ph.noiseHz, ph.noiseBw ?? 2000)
        curNoiseHz = ph.noiseHz
      }
    }

    // Amplitude targets for this sample.
    let tv = ph.voice
    let tn = 0
    let ta = 0
    switch (ph.kind) {
      case 'stop': {
        const burst = t >= 0.65
        tv = burst ? ph.voice * 1.4 : ph.voice * 0.5
        tn = burst ? ph.noise * 0.5 * (1 - (t - 0.65) / 0.35) : 0
        ta = burst && ph.voice === 0 ? 0.12 * (1 - (t - 0.65) / 0.35) : 0
        break
      }
      case 'aspirate':
        ta = ph.noise
        break
      case 'fricative':
        tn = ph.noise
        break
      case 'liquid':
        if (ph === PHONEMES.RR) tv *= 0.55 + 0.45 * Math.cos(2 * Math.PI * 26 * ((n - seg.start) / sr))
        if (ph === PHONEMES.RX) tv *= 0.35 + 0.65 * Math.abs(2 * t - 1)
        break
      case 'pause':
        tv = 0
        break
    }
    if (ended) tv = tn = ta = 0
    aVoice += (tv - aVoice) * kAmp
    aNoise += (tn * o.noiseLevel - aNoise) * kNoiseAmp
    aAsp += (ta * o.noiseLevel - aAsp) * kNoiseAmp

    // Pitch: gentle fall over the sentence, a lift on stressed vowels, a drop at the end.
    let target = o.pitch * (1.08 - 0.14 * seg.sentencePos)
    if (seg.stress && ph.kind === 'vowel') target *= 1.16
    if (seg.sentenceEnd) target *= 0.94
    if (o.quantizePitch) target = 440 * 2 ** (Math.round(12 * Math.log2(target / 440)) / 12)
    f0 += (target - f0) * kPitch

    phase += f0 / sr
    if (phase >= 1) phase -= 1
    const g = glottal(phase)
    const dg = (g - prevG) * (sr / (f0 * 8)) // differentiated pulse (lip radiation), roughly level across pitch
    prevG = g

    const source = dg * aVoice + noise() * aAsp
    let v = r4.run(r3.run(r2.run(r1.run(source))))
    // Hiss through its own band filter, with the DC removed.
    const hiss = rn.run(noise()) * aNoise
    v += hiss
    out[n] = v
  }

  // Gentle 2-pole low-pass over everything (keeps the robot warm, removes the fizz).
  if (o.lowpassHz > 0) lowpass(out, o.lowpassHz, sr)

  // Remove DC, normalize, then (optionally) quantize for an 8-bit timbre.
  let mean = 0
  for (let i = 0; i < total; i++) mean += out[i]!
  mean /= total
  let peak = 0
  for (let i = 0; i < total; i++) {
    out[i] = out[i]! - mean
    peak = Math.max(peak, Math.abs(out[i]!))
  }
  const gain = peak > 0 ? 0.9 / peak : 0
  const levels = o.bits > 0 ? 2 ** (o.bits - 1) : 0
  for (let i = 0; i < total; i++) {
    let s = out[i]! * gain
    if (levels) s = Math.round(s * levels) / levels
    out[i] = Math.max(-1, Math.min(1, s))
  }
  // Short fade-in and fade-out so the quantization never clicks.
  const fade = Math.min(total >> 1, Math.round(0.006 * sr))
  for (let i = 0; i < fade; i++) {
    out[i]! *= i / fade
    out[total - 1 - i]! *= i / fade
  }
  return out
}

/** Speak a phrase: numbers to words, words to phonemes, phonemes to samples. */
export function renderText(text: string, locale: Locale, options: VoiceOptions = {}): Float32Array {
  return renderPhones(textToPhones(spellNumbersInText(text, locale), locale), options)
}
