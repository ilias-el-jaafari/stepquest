import type { Locale } from '../../i18n/locale.ts'
import { textToPhones } from './g2p.ts'
import { limitSpokenText, normalizeSpeech } from './text.ts'
import { PHONEMES, type Bank, type Formants, type Phone, type Phoneme } from './phonemes.ts'

/**
 * A small formant speech synthesizer in the spirit of 1980s talking
 * computers, written from scratch after the published cascade/parallel
 * design (D. H. Klatt, "Software for a cascade/parallel formant
 * synthesizer", JASA 1980):
 *
 * - Every parameter (formants, bandwidths, amplitudes, frication shape,
 *   pitch) is a smooth track sampled every millisecond. Phoneme boundaries
 *   are keyframes: formants bend towards each consonant's locus
 *   (onset = locus + k · (vowel − locus)) and amplitudes cross-fade, so
 *   nothing ever switches abruptly. Filter coefficients are updated every
 *   few samples from the interpolated tracks.
 * - The voice source is a KLGLOTT88-style glottal flow derivative with an
 *   exponential return phase (no hard edge at closure, so less aliasing
 *   buzz), latched once per pitch period.
 * - Voicing and aspiration go through a cascade of resonators normalised to
 *   unity gain at 0 Hz, with a nasal pole/zero pair. Frication goes through
 *   a parallel bank of peak-normalised resonators plus a flat bypass, with
 *   its noise softened by a low-pass and modulated by the glottal cycle in
 *   voiced fricatives.
 * - A DC blocker, a gentle low-pass and a soft limiter finish the signal.
 *
 * Pure: returns samples.
 */

export type VoiceOptions = {
  sampleRate?: number
  /** Base pitch in Hz (about 110 is a low robot, 180 a higher one). */
  pitch?: number
  /** 1 is normal speed; 1.2 is 20 % faster. */
  speed?: number
  /** Bit depth of an optional retro quantization (0 = off). */
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
export const VOICE_DEFAULTS: Required<VoiceOptions> = { sampleRate: 22050, pitch: 112, speed: 0.9, bits: 0, quantizePitch: false, lowpassHz: 5000, noiseLevel: 0.5, seed: 1 }

/**
 * Replace invalid options (zero, negative, NaN, Infinity, out of range) with safe
 * values, so that no input can make the renderer throw or produce NaN.
 */
export function sanitizeOptions(options: VoiceOptions = {}): Required<VoiceOptions> {
  const num = (v: number | undefined, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
  const d = VOICE_DEFAULTS
  return {
    sampleRate: Math.round(num(options.sampleRate, d.sampleRate, 8000, 96000)),
    pitch: num(options.pitch, d.pitch, 60, 400),
    speed: num(options.speed, d.speed, 0.4, 2.5),
    bits: Math.round(num(options.bits, d.bits, 0, 16)),
    quantizePitch: options.quantizePitch ?? d.quantizePitch,
    lowpassHz: num(options.lowpassHz, d.lowpassHz, 0, 20000),
    noiseLevel: num(options.noiseLevel, d.noiseLevel, 0, 2),
    seed: Math.round(num(options.seed, d.seed, 0, 2 ** 31)),
  }
}

// ---------------------------------------------------------------------------
// Parameter tracks

/** Indices into a parameter frame. */
const P = {
  F1: 0,
  F2: 1,
  F3: 2,
  B1: 3,
  B2: 4,
  B3: 5,
  FNZ: 6,
  AV: 7,
  AH: 8,
  AF: 9,
  /** Parallel bank A2…A6, AB (6 values). */
  BANK: 10,
  TRILL: 16,
  F0: 17,
} as const
const NP = 18
const FORMANT_KEYS = [P.F1, P.F2, P.F3, P.B1, P.B2, P.B3, P.FNZ] as const
const AMP_KEYS = [P.AV, P.AH, P.AF, P.BANK, P.BANK + 1, P.BANK + 2, P.BANK + 3, P.BANK + 4, P.BANK + 5, P.TRILL] as const

/** Nasal pole (fixed); the nasal zero sits on it (cancelling it) except in nasals. */
const FNP = 270
const NASAL_ZERO = 450
const NO_BANK: Bank = [0, 0, 0, 0, 0, 0]

type Key = { t: number; v: number }
type Tracks = { frames: Float32Array[]; frameLen: number; total: number }

type Cls = 'V' | 'G' | 'N' | 'F' | 'H' | 'S' | 'P'
const clsOf = (ph: Phoneme): Cls => ({ vowel: 'V', glide: 'G', liquid: 'G', nasal: 'N', fricative: 'F', aspirate: 'H', stop: 'S', pause: 'P' } as const)[ph.kind]
const sonorant = (c: Cls) => c === 'V' || c === 'G'

/** Bandwidths (Hz) for F1–F3: a little wider than natural for a clean, non-ringing robot. */
function bandwidths(ph: Phoneme): Formants {
  if (ph.kind === 'nasal') return [120, 450, 500]
  if (ph.kind === 'fricative' || ph.kind === 'stop' || ph.kind === 'aspirate') return [200, 150, 200]
  return [80, 110, 170]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ms = (v: number, sr: number) => Math.round((v / 1000) * sr)

type Seg = { ph: Phoneme; cls: Cls; start: number; length: number; f: Formants; to: Formants; stress: boolean; pitch: number }

/** Lay the phones out in time and give each its formant targets and pitch. */
function layout(phones: readonly Phone[], o: Required<VoiceOptions>, lead: number): Seg[] {
  const sr = o.sampleRate
  // Word gaps are not silences in connected speech: drop them (commas and full stops stay).
  const list = phones.filter((p) => p.p !== '_')
  // Sentences, for the falling pitch.
  const sentence: number[] = []
  let s = 0
  for (const p of list) {
    sentence.push(s)
    if (p.p === '.') s++
  }
  const sizes = new Map<number, number>()
  const firsts = new Map<number, number>()
  sentence.forEach((k, i) => {
    if (!firsts.has(k)) firsts.set(k, i)
    sizes.set(k, (sizes.get(k) ?? 0) + 1)
  })
  const segs: Seg[] = []
  let pos = lead
  list.forEach((phone, i) => {
    const ph: Phoneme = PHONEMES[phone.p]
    const cls = clsOf(ph)
    const length = Math.max(1, Math.round(((ph.dur * (phone.len ?? 1)) / o.speed / 1000) * sr))
    let f = ph.f
    if (cls === 'H') {
      // /h/ is breath through the shape of the next vowel.
      const next = list.slice(i + 1).find((p) => sonorant(clsOf(PHONEMES[p.p])))
      if (next) f = PHONEMES[next.p].f
    }
    const k = sentence[i]!
    const n = sizes.get(k) ?? 1
    const at = n > 1 ? (i - firsts.get(k)!) / (n - 1) : 0
    const endSoon = list.slice(i + 1, i + 3).some((p) => p.p === '.' || p.p === ',') || i >= list.length - 2
    let pitch = o.pitch * (1.08 - 0.14 * at)
    if (phone.stress && cls === 'V') pitch *= 1.16
    if (endSoon) pitch *= 0.94
    if (o.quantizePitch) pitch = 440 * 2 ** (Math.round(12 * Math.log2(pitch / 440)) / 12)
    segs.push({ ph, cls, start: pos, length, f, to: ph.to ?? f, stress: !!phone.stress, pitch })
    pos += length
  })
  // Pauses hold the formants of what came before (nothing sounds anyway).
  segs.forEach((g, i) => {
    if (g.cls === 'P') {
      const prev = segs[i - 1]
      if (prev) g.f = g.to = prev.to
    }
  })
  return segs
}

/** Where the formants meet between two segments (Klatt's modified locus rule). */
function boundary(a: Seg | undefined, b: Seg | undefined): number[] {
  const fa = a ? [...a.to] : undefined
  const fb = b ? [...b.f] : undefined
  if (!fa) return fb!
  if (!fb) return fa
  if (a!.cls === 'P') return fb
  if (b!.cls === 'P') return fa
  const sa = sonorant(a!.cls) || a!.cls === 'H'
  const sb = sonorant(b!.cls) || b!.cls === 'H'
  if (sa === sb) return fa.map((v, i) => (v + fb[i]!) / 2)
  // One side is a consonant: onset = locus + k (vowel − locus); F1 stays low near a constriction.
  const [loc, vow] = sa ? [fb, fa] : [fa, fb]
  const k = [0.35, 0.55, 0.6]
  return loc.map((l, i) => l + k[i]! * (vow[i]! - l))
}

/** Steady values of the amplitude group for a segment. */
function amps(g: Seg, o: Required<VoiceOptions>): number[] {
  const v = new Array<number>(AMP_KEYS.length).fill(0)
  const noise = g.ph.noise * o.noiseLevel
  const b = g.ph.bank ?? NO_BANK
  switch (g.cls) {
    case 'V':
    case 'G':
    case 'N':
      v[0] = g.ph.voice
      break
    case 'F':
      v[0] = g.ph.voice
      v[2] = noise
      break
    case 'H':
      v[1] = noise
      break
    case 'S':
      v[0] = g.ph.voice // voice bar during the closure of b, d, g
      break
    case 'P':
      break
  }
  for (let i = 0; i < 6; i++) v[3 + i] = b[i]!
  if (g.ph === PHONEMES.RR) v[9] = 1
  return v
}

/**
 * Build the parameter tracks (one frame per millisecond) for a sequence of
 * segments. Exported for tests: every track must be continuous.
 */
export function buildTracks(phones: readonly Phone[], options: VoiceOptions = {}): Tracks & { segments: { start: number; length: number; kind: Phoneme['kind'] }[] } {
  const o = sanitizeOptions(options)
  const sr = o.sampleRate
  const lead = ms(90, sr)
  const segs = layout(phones, o, lead)
  const tail = ms(60, sr)
  const total = (segs.length ? segs[segs.length - 1]!.start + segs[segs.length - 1]!.length : lead) + tail
  const keys: Key[][] = Array.from({ length: NP }, () => [])
  const put = (t: number, idx: readonly number[], vals: readonly number[]) => idx.forEach((p, i) => keys[p]!.push({ t, v: vals[i]! }))

  segs.forEach((g, i) => {
    const prev = segs[i - 1]
    const next = segs[i + 1]
    const s = g.start
    const e = g.start + g.length
    // --- formants: boundary → target → (diphthong) → boundary
    const bIn = boundary(prev, g)
    const bOut = boundary(g, next)
    const bw = bandwidths(g.ph)
    const fnz = g.cls === 'N' ? NASAL_ZERO : FNP
    const slow = sonorant(g.cls)
    const tIn = Math.min(ms(slow ? 45 : 12, sr), Math.round(g.length * (slow ? 0.4 : 0.3)))
    const tOut = Math.min(ms(slow ? 45 : 12, sr), Math.round(g.length * (slow ? 0.4 : 0.3)))
    const frm = (f: readonly number[], w: Formants = bw) => [f[0]!, f[1]!, f[2]!, w[0], w[1], w[2], fnz]
    // At a boundary keep the vowel's (narrow) bandwidths: widening them inside the vowel makes the pulses spiky.
    const bwIn = prev && sonorant(prev.cls) && !sonorant(g.cls) ? bandwidths(prev.ph) : bw
    if (i === 0) put(0, FORMANT_KEYS, frm(g.f))
    put(s, FORMANT_KEYS, frm(bIn, bwIn))
    put(s + tIn, FORMANT_KEYS, frm(g.f))
    put(Math.max(s + tIn, e - tOut), FORMANT_KEYS, frm(g.to))
    // (the boundary keyframe is written by the next segment; write the last one here)
    if (!next) {
      put(e, FORMANT_KEYS, frm(bOut))
      put(total, FORMANT_KEYS, frm(bOut))
    }

    // --- amplitudes: cross-fade over a few ms around each boundary
    const a = amps(g, o)
    const ramp = Math.min(ms(g.cls === 'S' ? 4 : 8, sr), Math.round(g.length * 0.25))
    // Voicing fades out gently before a voiceless consonant (and the silence of a pause).
    const unvoicedNext = !next || next.cls === 'P' || ((next.cls === 'S' || next.cls === 'F' || next.cls === 'H') && next.ph.voice === 0)
    const rampOut = sonorant(g.cls) && unvoicedNext ? Math.min(ms(18, sr), Math.round(g.length * 0.35)) : ramp
    if (i === 0) put(0, AMP_KEYS, new Array(AMP_KEYS.length).fill(0))
    const lenited = g.cls === 'S' && g.ph.voice > 0 && prev !== undefined && next !== undefined && sonorant(prev.cls) && sonorant(next.cls)
    if (lenited) {
      // b, d, g between vowels are soft approximants (Spanish "la ruta", "de vuelta"): a dip, no burst.
      const dip = [...a]
      dip[0] = 0.45
      put(s + ramp, AMP_KEYS, dip)
      put(e - ramp, AMP_KEYS, dip)
    } else if (g.cls === 'S') {
      // Closure, then a sharp burst that decays into the next sound.
      const close = s + Math.round(g.length * 0.7)
      put(s + ramp, AMP_KEYS, a)
      put(close, AMP_KEYS, a)
      const burst = [...a]
      burst[2] = g.ph.noise * o.noiseLevel
      const aspirated = g.ph.voice === 0 && next !== undefined && sonorant(next.cls)
      burst[1] = aspirated ? 0.25 * o.noiseLevel : 0
      put(close + ms(5, sr), AMP_KEYS, burst)
      const tailA = [...burst]
      tailA[2] = tailA[2]! * 0.25
      put(e - ms(1, sr), AMP_KEYS, tailA)
    } else if (g.ph === PHONEMES.RX) {
      // The Spanish tap: a quick dip of the voice in the middle.
      const mid = [...a]
      mid[0] = mid[0]! * 0.35
      put(s + ramp, AMP_KEYS, a)
      put(s + Math.round(g.length / 2), AMP_KEYS, mid)
      put(e - ramp, AMP_KEYS, a)
    } else {
      put(s + ramp, AMP_KEYS, a)
      put(e - rampOut, AMP_KEYS, a)
    }
    if (!next) {
      put(e + ms(10, sr), AMP_KEYS, new Array(AMP_KEYS.length).fill(0))
      put(total, AMP_KEYS, new Array(AMP_KEYS.length).fill(0))
    }

    // --- pitch: a target in the middle of each voiced segment
    if (i === 0) put(0, [P.F0], [g.pitch])
    if (g.cls !== 'P') put(s + Math.round(g.length / 2), [P.F0], [g.pitch])
    if (!next) put(total, [P.F0], [g.pitch * 0.95])
  })
  if (!segs.length) {
    put(0, FORMANT_KEYS, [500, 1500, 2500, 80, 110, 170, FNP])
    put(0, AMP_KEYS, new Array(AMP_KEYS.length).fill(0))
    put(0, [P.F0], [o.pitch])
  }

  // Sample the keyframes every millisecond (smoothstep between keys).
  const frameLen = Math.max(1, ms(1, sr))
  const nFrames = Math.ceil(total / frameLen) + 1
  const frames = keys.map((list) => {
    list.sort((x, y) => x.t - y.t)
    const out = new Float32Array(nFrames)
    let k = 0
    for (let fI = 0; fI < nFrames; fI++) {
      const t = fI * frameLen
      while (k < list.length - 2 && list[k + 1]!.t <= t) k++
      const a = list[k]!
      const b = list[Math.min(k + 1, list.length - 1)]!
      if (t <= a.t || b.t <= a.t) out[fI] = t <= a.t ? a.v : b.v
      else if (t >= b.t) out[fI] = b.v
      else {
        const x = (t - a.t) / (b.t - a.t)
        out[fI] = lerp(a.v, b.v, x * x * (3 - 2 * x))
      }
    }
    return out
  })
  return { frames, frameLen, total, segments: segs.map((g) => ({ start: g.start, length: g.length, kind: g.ph.kind })) }
}

// ---------------------------------------------------------------------------
// Filters

/** Two-pole resonator. `dc` mode: unity gain at 0 Hz (cascade); else unity at the peak (parallel). */
class Resonator {
  private a = 1
  private b = 0
  private c = 0
  private y1 = 0
  private y2 = 0
  private readonly sr: number
  private readonly peak: boolean
  constructor(sr: number, peak = false) {
    this.sr = sr
    this.peak = peak
  }
  set(f: number, bw: number) {
    const T = 1 / this.sr
    const w = 2 * Math.PI * Math.min(Math.max(f, 20), this.sr * 0.45) * T
    const r = Math.exp(-Math.PI * Math.max(bw, 10) * T)
    this.c = -r * r
    this.b = 2 * r * Math.cos(w)
    if (!this.peak) this.a = 1 - this.b - this.c
    else {
      // |1 − b e^{−jw} − c e^{−2jw}| at the centre frequency.
      const re = 1 - this.b * Math.cos(w) - this.c * Math.cos(2 * w)
      const im = this.b * Math.sin(w) + this.c * Math.sin(2 * w)
      this.a = Math.hypot(re, im)
    }
  }
  reset() {
    this.y1 = 0
    this.y2 = 0
  }
  run(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Two-zero anti-resonator (the nasal zero), unity gain at 0 Hz. */
class AntiResonator {
  private a = 1
  private b = 0
  private c = 0
  private x1 = 0
  private x2 = 0
  private readonly sr: number
  constructor(sr: number) {
    this.sr = sr
  }
  set(f: number, bw: number) {
    const T = 1 / this.sr
    const r = Math.exp(-Math.PI * bw * T)
    const c0 = -r * r
    const b0 = 2 * r * Math.cos(2 * Math.PI * f * T)
    const a0 = 1 - b0 - c0
    this.a = 1 / a0
    this.b = -b0 / a0
    this.c = -c0 / a0
  }
  reset() {
    this.x1 = 0
    this.x2 = 0
  }
  run(x: number): number {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2
    this.x2 = this.x1
    this.x1 = x
    return y
  }
}

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

// ---------------------------------------------------------------------------
// Rendering

/** Parallel frication bank centres (A2…A6) and bandwidths, as in Klatt's parallel branch. */
const BANK_F = [1500, 2500, 3300, 3900, 4700] as const
const BANK_B = [200, 300, 350, 400, 600] as const

/** Statistics from the last render, for tests and tuning. */
export type RenderStats = { peakBeforeGain: number; limited: number }
let lastStats: RenderStats = { peakBeforeGain: 0, limited: 0 }
export const renderStats = (): RenderStats => lastStats

export function renderPhones(phones: readonly Phone[], options: VoiceOptions = {}): Float32Array {
  const o = sanitizeOptions(options)
  const sr = o.sampleRate
  const { frames, frameLen, total } = buildTracks(phones, o)
  const out = new Float32Array(total)
  const audible = phones.some((p) => PHONEMES[p.p].kind !== 'pause')
  if (!audible) return out

  const casc = [new Resonator(sr), new Resonator(sr), new Resonator(sr)]
  const r4 = new Resonator(sr)
  const r5 = new Resonator(sr)
  r4.set(3300, 250)
  r5.set(3850, 300)
  const nasalPole = new Resonator(sr)
  nasalPole.set(FNP, 100)
  const nasalZero = new AntiResonator(sr)
  const par = BANK_F.map((f, i) => {
    const r = new Resonator(sr, true)
    r.set(f, BANK_B[i]!)
    return r
  })

  let seed = o.seed >>> 0 || 1
  const kNoise = 1 - Math.exp((-2 * Math.PI * 3500) / sr)
  let lpNoise = 0
  const value = (p: number, n: number) => {
    const fr = frames[p]!
    const x = n / frameLen
    const i = Math.floor(x)
    const a = fr[Math.min(i, fr.length - 1)]!
    const b = fr[Math.min(i + 1, fr.length - 1)]!
    return a + (b - a) * (x - i)
  }

  // Glottal source state (latched per period).
  let phase = 0 // samples into the current period
  let period = sr / o.pitch
  let te = 0.6 * period
  let ta = 0.05 * period
  const UPDATE = 4
  const F = [0, 0, 0, 0, 0, 0, 0]
  let av = 0
  let ah = 0
  let af = 0
  let trill = 0
  const bankG = [0, 0, 0, 0, 0, 0]

  for (let n = 0; n < total; n++) {
    if (n % UPDATE === 0) {
      for (let i = 0; i < 7; i++) F[i] = value(FORMANT_KEYS[i]!, n)
      for (let i = 0; i < 3; i++) casc[i]!.set(F[i]!, F[3 + i]!)
      nasalZero.set(F[6]!, 100)
      av = value(P.AV, n)
      ah = value(P.AH, n)
      af = value(P.AF, n)
      trill = value(P.TRILL, n)
      for (let i = 0; i < 6; i++) bankG[i] = value(P.BANK + i, n)
    }
    // New pitch period: latch f0 and the glottal timing.
    if (phase >= period) {
      phase -= period
      const f0 = Math.max(50, value(P.F0, n))
      period = sr / f0
      te = 0.6 * period
      ta = 0.05 * period
    }
    // Flow derivative: rising polynomial (KLGLOTT88 shape) to the main excitation at te, then an exponential return.
    const t = phase
    const dg = t < te ? 2 * (t / te) - 3 * (t / te) ** 2 : -Math.exp(-(t - te) / ta)
    const closed = t >= te
    phase += 1

    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    lpNoise += (seed / 2147483648 - 1 - lpNoise) * kNoise
    // In voiced sounds the turbulence is stronger while the glottis is open.
    const noise = lpNoise * (av > 0.05 && closed ? 0.5 : 1)

    let voice = av
    if (trill > 0) voice *= 1 - trill * 0.45 * (1 - Math.cos((2 * Math.PI * 26 * n) / sr))
    const source = dg * voice + noise * ah * 0.6
    let v = casc[0]!.run(nasalZero.run(nasalPole.run(source)))
    v = r5.run(r4.run(casc[2]!.run(casc[1]!.run(v))))
    if (af > 0.0005) {
      let p = 0
      for (let i = 0; i < 5; i++) if (bankG[i]! > 0) p += (i % 2 ? -1 : 1) * bankG[i]! * par[i]!.run(noise)
      p += bankG[5]! * noise
      v += p * af * 3
    } else for (const r of par) r.run(0)
    if (!Number.isFinite(v)) {
      // Defence in depth: a non-finite value would poison every filter state for the rest of the phrase.
      v = 0
      for (const r of [...casc, r4, r5, nasalPole, ...par]) r.reset()
      nasalZero.reset()
    }
    out[n] = v
  }

  // DC blocker (20 Hz), then a gentle low-pass.
  let x1 = 0
  let y1 = 0
  const kDc = 1 - (2 * Math.PI * 20) / sr
  for (let i = 0; i < total; i++) {
    const y = out[i]! - x1 + kDc * y1
    x1 = out[i]!
    y1 = y
    out[i] = y
  }
  if (o.lowpassHz > 0) lowpass(out, o.lowpassHz, sr)

  // Level: peak-normalise, with a soft limiter so the rare spike cannot clip.
  let peak = 0
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]!))
  const gain = peak > 0 ? 0.92 / peak : 0
  const levels = o.bits > 0 ? 2 ** (o.bits - 1) : 0
  let limited = 0
  for (let i = 0; i < total; i++) {
    let s = out[i]! * gain
    if (Math.abs(s) > 0.85) {
      limited++
      const over = Math.abs(s) - 0.85
      s = Math.sign(s) * (0.85 + 0.15 * Math.tanh(over / 0.15))
    }
    if (levels) s = Math.round(s * levels) / levels
    out[i] = s
  }
  lastStats = { peakBeforeGain: peak, limited }
  // Fade the very ends so playback never clicks.
  const fade = Math.min(total >> 1, ms(6, sr))
  for (let i = 0; i < fade; i++) {
    // (+ 0 turns a negative zero into a plain zero)
    out[i] = out[i]! * (i / fade) + 0
    out[total - 1 - i] = out[total - 1 - i]! * (i / fade) + 0
  }
  return out
}

/** Speak a phrase: limit its length, numbers to words, words to phonemes, phonemes to samples. */
export function renderText(text: string, locale: Locale, options: VoiceOptions = {}): Float32Array {
  return renderPhones(textToPhones(normalizeSpeech(limitSpokenText(text), locale), locale), options)
}
