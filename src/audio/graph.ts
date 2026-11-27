import { applyOps, holdAt, jingleDuckOps, rampTo } from './automation.ts'
import { MUSIC_BUS_MAX } from './chiptune.ts'
import { busGains, sliderToGain, type AudioSettings } from './settings.ts'

/**
 * The Web Audio graph and its shared resources:
 *
 *   music notes → gate → duck → jingleDuck → music ─┐
 *   voice phrases (one gain each) → voice ──────────┼→ master → limiter → destination
 *   sound effects → sfx ────────────────────────┘
 *
 * `gate` fades the music in and out with the walker, `duck` lowers it while the
 * voice speaks and `jingleDuck` while a jingle plays (separate, so neither releases the other). Created once per AudioContext, inside a user gesture.
 */

export type Graph = {
  ctx: AudioContext
  master: GainNode
  music: GainNode
  voice: GainNode
  sfx: GainNode
  duck: GainNode
  jingleDuck: GainNode
  gate: GainNode
  waves: ReadonlyMap<string, PeriodicWave>
  /** One second of LFSR noise for drums and effects. */
  noise: AudioBuffer
}

const DUCK_LEVEL = 0.3

/** Fourier series of a pulse wave with the given duty cycle (the classic 12.5 / 25 / 50 % square voices). */
export function pulseCoefficients(duty: number, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1)
  const imag = new Float32Array(harmonics + 1)
  for (let n = 1; n <= harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty)
  return { real, imag }
}

/** 15-bit linear-feedback shift register noise, like 8-bit sound chips. */
export function lfsrNoise(length: number, short = false): Float32Array {
  const out = new Float32Array(length)
  let reg = 1
  for (let i = 0; i < length; i++) {
    const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1
    reg = (reg >> 1) | (bit << 14)
    out[i] = reg & 1 ? 0.8 : -0.8
  }
  return out
}

/** Build the buses, the pulse waves and the noise buffer for a new context. */
export function createGraph(ctx: AudioContext): Graph {
  const master = ctx.createGain()
  // A gentle limiter where the browser has one, so music, jingles and voice together never clip.
  if (typeof ctx.createDynamicsCompressor === 'function') {
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.15
    master.connect(limiter).connect(ctx.destination)
  } else master.connect(ctx.destination)
  const music = ctx.createGain()
  const voice = ctx.createGain()
  const sfx = ctx.createGain()
  const duck = ctx.createGain()
  const jingleDuck = ctx.createGain()
  const gate = ctx.createGain()
  gate.gain.value = 0
  gate.connect(duck).connect(jingleDuck).connect(music).connect(master)
  voice.connect(master)
  sfx.connect(master)
  const waves = new Map<string, PeriodicWave>()
  for (const duty of [0.125, 0.25, 0.5]) {
    const { real, imag } = pulseCoefficients(duty)
    waves.set(`pulse${Math.round(duty * 1000)}`, ctx.createPeriodicWave(real, imag))
  }
  const samples = lfsrNoise(ctx.sampleRate)
  const noise = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  noise.getChannelData(0).set(samples)
  return { ctx, master, music, voice, sfx, duck, jingleDuck, gate, waves, noise }
}

/** Move the bus levels to the sliders (50 ms glide, no jumps). */
export function applyBusGains(g: Graph, settings: AudioSettings): void {
  const gains = busGains(settings)
  const t = g.ctx.currentTime
  rampTo(g.master.gain, sliderToGain(gains.master), t, 0.05)
  rampTo(g.music.gain, sliderToGain(gains.music) * MUSIC_BUS_MAX, t, 0.05)
  rampTo(g.voice.gain, sliderToGain(gains.voice) * 1.6, t, 0.05)
  rampTo(g.sfx.gain, sliderToGain(gains.sfx), t, 0.05)
}

/** Lower the music while the voice speaks. */
export function duckMusic(g: Graph | undefined, on: boolean): void {
  if (g) rampTo(g.duck.gain, on ? DUCK_LEVEL : 1, g.ctx.currentTime, on ? 0.05 : 0.3)
}

/** Lower the loop under a jingle of `seconds`, then bring it back (all on the audio clock). */
export function duckForJingle(g: Graph | undefined, seconds: number): void {
  if (!g) return
  const t = g.ctx.currentTime
  holdAt(g.jingleDuck.gain, t)
  applyOps(g.jingleDuck.gain, jingleDuckOps(t, seconds))
}

/** Fade the music in (walking) or out (standing still). */
export function gateMusic(g: Graph | undefined, open: boolean): void {
  if (g) rampTo(g.gate.gain, open ? 1 : 0, g.ctx.currentTime, open ? 0.5 : 0.35)
}

/** Disconnect nodes whose sound has ended, so the browser can free them at once. */
export function release(...nodes: ({ disconnect(): void } | undefined)[]): void {
  for (const n of nodes) {
    try {
      n?.disconnect()
    } catch {
      // already disconnected
    }
  }
}
