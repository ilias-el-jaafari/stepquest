import type { Locale } from '../i18n/locale.ts'
import { calmEvents, eventsAt, midiToHz, nextBarStep, type Drum, type NoteEvent } from './chiptune.ts'
import { scheduleWindow, type ClockState } from './scheduler.ts'
import { busGains, loadAudioSettings, saveAudioSettings, sliderToGain, type AudioSettings } from './settings.ts'
import { SFX, type SfxName, type SfxNote } from './sfx.ts'
import { glideTempo, MENU_BPM } from './tempo.ts'
import { renderText } from './voice/synth.ts'
import { VoiceQueue } from './voiceQueue.ts'
import { bubbleDurationMs, type SpokenPhrase } from './speechBubble.ts'

/**
 * Web Audio side of the sound: buses (master → music / voice / effects),
 * the chiptune player, the voice player and the effects. The AudioContext is
 * only created inside a user gesture (`unlock`), as iOS Safari requires, and
 * is resumed after interruptions (calls, Siri, locking the phone) on the
 * next tap or when the page becomes visible again.
 */

export type EngineStatus = 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed'
export type MusicMode = 'menu' | 'quest'
export type EngineSnapshot = { settings: AudioSettings; status: EngineStatus; music: 'off' | 'playing' | 'paused'; musicMode: MusicMode; speaking: boolean; phrase: SpokenPhrase | undefined }

type Ctor = typeof AudioContext
const VOICE_RATE = 22050
const LOOKAHEAD_S = 0.15
const TICK_MS = 25
const DUCK = 0.3
/** Seed of the planning-screen tune. */
const MENU_SEED = 2026

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

export class AudioEngine {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private buses: { music: GainNode; voice: GainNode; sfx: GainNode; duck: GainNode; gate: GainNode } | undefined
  private waves = new Map<string, PeriodicWave>()
  private noise: AudioBuffer | undefined
  private settings: AudioSettings
  private snapshot: EngineSnapshot
  private listeners = new Set<() => void>()
  // Music.
  private timer: ReturnType<typeof setInterval> | undefined
  private clock: ClockState = { nextTime: 0, step: 0 }
  private seed = 1
  private bpm = 104
  private targetBpm: number | undefined = undefined
  private lastTick = 0
  private musicState: EngineSnapshot['music'] = 'off'
  private pauseAt = 0
  private mode: MusicMode = 'quest'
  /** A new tune waiting for the next bar line (smooth switch between menu and quest). */
  private pending: { seed: number; atStep: number } | undefined
  // Voice.
  private queue = new VoiceQueue()
  private source: AudioBufferSourceNode | undefined
  /** The phrase being spoken (or shown silently); the map draws it as a speech bubble. */
  private phrase: SpokenPhrase | undefined
  private phraseId = 0
  private silentTimer: ReturnType<typeof setTimeout> | undefined
  private cache = new Map<string, AudioBuffer>()
  private listenersInstalled = false
  private readonly win: (Window & typeof globalThis) | undefined

  constructor(settings: AudioSettings = loadAudioSettings(), win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window) {
    this.settings = settings
    this.win = win
    this.snapshot = { settings, status: 'locked', music: 'off', musicMode: 'quest', speaking: false, phrase: undefined }
  }

  // ---- state for React (useSyncExternalStore) ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  private emit() {
    const status: EngineStatus = !this.ctx ? 'locked' : (this.ctx.state as EngineStatus)
    this.snapshot = { settings: this.settings, status, music: this.musicState, musicMode: this.mode, speaking: !!this.source, phrase: this.phrase }
    for (const fn of this.listeners) fn()
  }

  get supported(): boolean {
    return !!this.ctor()
  }

  private ctor(): Ctor | undefined {
    const w = this.win as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor } | undefined
    return w?.AudioContext ?? w?.webkitAudioContext
  }

  // ---- settings ----

  getSettings(): AudioSettings {
    return this.settings
  }

  updateSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch }
    saveAudioSettings(this.settings)
    this.applyGains()
    if (this.settings.muted) {
      this.phrase = undefined
      this.stopVoice()
    }
    this.emit()
  }

  private applyGains() {
    if (!this.ctx || !this.master || !this.buses) return
    const g = busGains(this.settings)
    const t = this.ctx.currentTime
    const set = (node: GainNode, v: number) => {
      node.gain.cancelScheduledValues(t)
      node.gain.setTargetAtTime(v, t, 0.05)
    }
    set(this.master, sliderToGain(g.master))
    set(this.buses.music, sliderToGain(g.music))
    set(this.buses.voice, sliderToGain(g.voice) * 1.6)
    set(this.buses.sfx, sliderToGain(g.sfx))
  }

  // ---- unlocking and recovery ----

  /** Call from a click/tap handler. Creates or resumes the AudioContext. */
  unlock(): void {
    const C = this.ctor()
    if (!C) return
    if (!this.ctx) {
      // iOS: the "ambient" audio session mixes with the user's own music or podcast instead of
      // stopping it, and follows the ringer/silent switch (silent mode mutes the game, like other games).
      const nav = this.win?.navigator as unknown as { audioSession?: { type: string } } | undefined
      try {
        if (nav?.audioSession) nav.audioSession.type = 'ambient'
      } catch {
        // Not supported: keep the default.
      }
      const ctx = new C({ latencyHint: 'interactive' })
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
      const mk = () => ctx.createGain()
      this.buses = { music: mk(), voice: mk(), sfx: mk(), duck: mk(), gate: mk() }
      this.buses.gate.gain.value = 0
      this.buses.gate.connect(this.buses.duck).connect(this.buses.music).connect(this.master)
      this.buses.voice.connect(this.master)
      this.buses.sfx.connect(this.master)
      for (const duty of [0.125, 0.25, 0.5]) {
        const { real, imag } = pulseCoefficients(duty)
        this.waves.set(`pulse${duty * 1000}`, ctx.createPeriodicWave(real, imag))
      }
      const n = lfsrNoise(ctx.sampleRate)
      this.noise = ctx.createBuffer(1, n.length, ctx.sampleRate)
      this.noise.getChannelData(0).set(n)
      ctx.onstatechange = () => {
        this.emit()
        if (ctx.state !== 'running' && ctx.state !== 'closed' && this.win?.document.visibilityState === 'visible') void ctx.resume().catch(() => {})
      }
      this.applyGains()
      // Music asked for before the first tap (planning screen) fades in now.
      if (this.musicState === 'playing') this.gate(true)
      this.installRecovery()
    }
    const ctx = this.ctx
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    // Old iOS needs a sound started inside the gesture: one silent sample.
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate)
      const s = ctx.createBufferSource()
      s.buffer = b
      s.connect(ctx.destination)
      s.start()
    } catch {
      // ignore
    }
    this.emit()
  }

  /**
   * Unlock on the next tap or key press anywhere (used when a saved quest is
   * resumed after a reload, which happens without a gesture).
   */
  armUnlock(): void {
    if (this.ctx || !this.win || this.armed) return
    this.armed = true
    const doc = this.win.document
    const types = ['pointerup', 'touchend', 'keydown', 'click']
    const once = () => {
      for (const type of types) doc.removeEventListener(type, once, true)
      this.armed = false
      this.unlock()
    }
    for (const type of types) doc.addEventListener(type, once, true)
  }

  private armed = false

  private installRecovery() {
    if (this.listenersInstalled || !this.win) return
    this.listenersInstalled = true
    const tryResume = () => {
      const ctx = this.ctx
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().then(() => this.emit(), () => {})
    }
    for (const type of ['pointerup', 'touchend', 'keydown', 'click']) this.win.document.addEventListener(type, tryResume, { capture: true, passive: true })
    this.win.document.addEventListener('visibilitychange', () => {
      if (this.win?.document.visibilityState === 'visible') tryResume()
    })
    this.win.addEventListener('pageshow', tryResume)
    this.win.addEventListener('focus', tryResume)
  }

  // ---- sound effects ----

  playSfx(name: SfxName): void {
    if (!this.ctx || !this.buses || this.ctx.state !== 'running') return
    if (busGains(this.settings).sfx <= 0) return
    const t0 = this.ctx.currentTime + 0.01
    for (const note of SFX[name]) this.sfxNote(note, t0)
  }

  private sfxNote(n: SfxNote, t0: number) {
    const ctx = this.ctx!
    const gain = ctx.createGain()
    const level = 0.22 * (n.gain ?? 1)
    const start = t0 + n.at
    const end = start + n.len
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(level, start + 0.004)
    gain.gain.setValueAtTime(level, Math.max(start + 0.005, end - 0.03))
    gain.gain.linearRampToValueAtTime(0, end)
    gain.connect(this.buses!.sfx)
    if (n.wave === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = this.noise ?? null
      src.connect(gain)
      src.start(start)
      src.stop(end + 0.02)
      return
    }
    const osc = ctx.createOscillator()
    if (n.wave === 'triangle') osc.type = 'triangle'
    else osc.setPeriodicWave(this.waves.get(n.wave === 'pulse25' ? 'pulse250' : 'pulse500')!)
    osc.frequency.setValueAtTime(n.hz, start)
    if (n.slideTo) osc.frequency.linearRampToValueAtTime(n.slideTo, end)
    osc.connect(gain)
    osc.start(start)
    osc.stop(end + 0.02)
  }

  // ---- voice ----

  /**
   * Speak a phrase (already translated). Higher priority phrases cut in on lower ones.
   * Without a running, audible voice the phrase still goes through the same queue
   * and is only shown (as a bubble) for a time based on its length.
   */
  say(text: string, locale: Locale, priority = 1): void {
    this.locale = locale
    const action = this.queue.push({ text, priority, at: Date.now() })
    if (action === 'interrupt') {
      this.stopSource()
      this.play(text, locale)
    } else if (action === 'play') this.play(text, locale)
  }

  private canSpeak(): boolean {
    return !!this.ctx && !!this.buses && this.ctx.state === 'running' && !this.settings.muted && busGains(this.settings).voice > 0
  }

  private play(text: string, locale: Locale) {
    this.phrase = { id: ++this.phraseId, text }
    if (this.canSpeak()) this.playPhrase(text, locale)
    else {
      this.silentTimer = setTimeout(() => this.advance(), bubbleDurationMs(text))
      this.emit()
    }
  }

  /** The current phrase ended (spoken or shown): start the next one, or clear the bubble. */
  private advance() {
    this.silentTimer = undefined
    const next = this.queue.next(Date.now())
    if (next) this.play(next.text, this.locale)
    else {
      this.phrase = undefined
      this.duck(false)
    }
    this.emit()
  }

  private locale: Locale = 'en'

  private bufferFor(text: string, locale: Locale): AudioBuffer {
    const key = `${locale}|${text}`
    let buf = this.cache.get(key)
    if (!buf) {
      const samples = renderText(text, locale, { sampleRate: VOICE_RATE })
      buf = this.ctx!.createBuffer(1, samples.length, VOICE_RATE)
      buf.getChannelData(0).set(samples)
      this.cache.set(key, buf)
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!)
    } else {
      // Refresh its place in the LRU.
      this.cache.delete(key)
      this.cache.set(key, buf)
    }
    return buf
  }

  private playPhrase(text: string, locale: Locale) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.bufferFor(text, locale)
    src.connect(this.buses!.voice)
    src.onended = () => {
      if (this.source !== src) return
      this.source = undefined
      this.advance()
    }
    this.source = src
    this.duck(true)
    src.start(ctx.currentTime + 0.02)
    this.emit()
  }

  private stopSource() {
    const s = this.source
    this.source = undefined
    clearTimeout(this.silentTimer)
    this.silentTimer = undefined
    if (s) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
  }

  stopVoice(): void {
    this.stopSource()
    this.queue.clear()
    const had = this.phrase !== undefined
    this.phrase = undefined
    this.duck(false)
    if (had) this.emit()
  }

  private duck(on: boolean) {
    if (!this.ctx || !this.buses) return
    const t = this.ctx.currentTime
    this.buses.duck.gain.cancelScheduledValues(t)
    this.buses.duck.gain.setTargetAtTime(on ? DUCK : 1, t, on ? 0.05 : 0.3)
  }

  // ---- music ----

  /**
   * Calm planning-screen music at a steady tempo. Audible once audio is
   * unlocked by a tap; follows mute and the volume sliders like all music.
   * If a quest tune is playing it glides down and switches at the next bar.
   */
  playMenuMusic(): void {
    this.mode = 'menu'
    if (this.musicState === 'playing') {
      this.switchTune(MENU_SEED)
      this.targetBpm = MENU_BPM
    } else {
      this.seed = MENU_SEED
      this.pending = undefined
      this.clock = { nextTime: 0, step: 0 }
      this.bpm = MENU_BPM
      this.targetBpm = MENU_BPM
      this.lastTick = 0
      this.musicState = 'playing'
      this.gate(true)
    }
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }

  private switchTune(seed: number) {
    if (seed === this.seed && !this.pending) return
    this.pending = { seed, atStep: nextBarStep(this.clock.step) }
  }

  /**
   * Start the quest chiptune, which follows the walking pace (paused until a
   * walking tempo arrives). Coming from the menu music, it keeps playing at
   * the calm tempo, changes tune at the next bar and then follows the pace.
   */
  startMusic(seed: number): void {
    const fromMenu = this.mode === 'menu' && this.musicState === 'playing'
    this.mode = 'quest'
    if (fromMenu) {
      this.switchTune(seed)
      if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS)
      this.emit()
      return
    }
    this.pending = undefined
    this.seed = seed
    this.clock = { nextTime: 0, step: 0 }
    this.targetBpm = undefined
    this.musicState = 'paused'
    this.lastTick = 0
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }

  /** Walking tempo in BPM, or undefined when standing still (the music fades out and waits). */
  setTempo(bpm: number | undefined): void {
    if (this.musicState === 'off') return
    if (bpm !== undefined && this.targetBpm === undefined) {
      // Starting again: begin at the walking tempo rather than gliding up from the old one.
      if (this.musicState === 'paused') {
        this.bpm = bpm
        if (this.ctx) this.clock = { nextTime: this.ctx.currentTime + 0.05, step: this.clock.step }
      }
      this.musicState = 'playing'
      this.gate(true)
    } else if (bpm === undefined && this.targetBpm !== undefined) {
      this.gate(false)
      this.pauseAt = Date.now() + 1500
    }
    this.targetBpm = bpm
    this.emit()
  }

  stopMusic(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.musicState = 'off'
    this.targetBpm = undefined
    this.pending = undefined
    this.gate(false)
    this.emit()
  }

  get tempo(): number {
    return this.bpm
  }

  private gate(open: boolean) {
    if (!this.ctx || !this.buses) return
    const t = this.ctx.currentTime
    this.buses.gate.gain.cancelScheduledValues(t)
    this.buses.gate.gain.setTargetAtTime(open ? 1 : 0, t, open ? 0.5 : 0.35)
  }

  private tick() {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running' || !this.buses) return
    const now = ctx.currentTime
    const dt = this.lastTick ? now - this.lastTick : 0
    this.lastTick = now
    if (this.targetBpm === undefined) {
      if (this.musicState === 'playing' && Date.now() >= this.pauseAt) {
        this.musicState = 'paused'
        this.emit()
      }
      if (this.musicState === 'paused') return
    } else this.bpm = glideTempo(this.bpm, this.targetBpm, dt)
    if (busGains(this.settings).music <= 0) {
      // Keep the clock moving silently so the music picks up in time.
      this.clock = scheduleWindow(this.clock, now, LOOKAHEAD_S, this.bpm).state
      return
    }
    const { steps, state } = scheduleWindow(this.clock, now, LOOKAHEAD_S, this.bpm)
    this.clock = state
    const calm = this.mode === 'menu'
    for (const s of steps) {
      if (this.pending && s.step >= this.pending.atStep) {
        this.seed = this.pending.seed
        this.pending = undefined
      }
      const raw = eventsAt(this.seed, s.step)
      const ev = calm ? calmEvents(raw) : raw
      if (ev.lead) this.tone('pulse250', ev.lead, s.time, s.duration, 0.11)
      if (ev.arp) this.tone('pulse125', ev.arp, s.time, s.duration, 0.035)
      if (ev.bass) this.tone('triangle', ev.bass, s.time, s.duration, 0.2)
      if (ev.drum) this.drum(ev.drum, s.time)
    }
  }

  private tone(wave: string, note: NoteEvent, time: number, stepDur: number, level: number) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    if (wave === 'triangle') osc.type = 'triangle'
    else osc.setPeriodicWave(this.waves.get(wave)!)
    osc.frequency.value = midiToHz(note.midi)
    const g = ctx.createGain()
    const end = time + note.steps * stepDur * 0.92
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(level, time + 0.005)
    g.gain.setTargetAtTime(level * 0.6, time + 0.02, 0.08)
    g.gain.setTargetAtTime(0, Math.max(time + 0.01, end - 0.02), 0.01)
    osc.connect(g).connect(this.buses!.gate)
    osc.start(time)
    osc.stop(end + 0.08)
  }

  private drum(kind: Drum, time: number) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    g.connect(this.buses!.gate)
    if (kind === 'kick') {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(160, time)
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.12)
      g.gain.setValueAtTime(0.32, time)
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.14)
      osc.connect(g)
      osc.start(time)
      osc.stop(time + 0.16)
      return
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noise ?? null
    const filter = ctx.createBiquadFilter()
    filter.type = kind === 'hat' ? 'highpass' : 'bandpass'
    filter.frequency.value = kind === 'hat' ? 7000 : 1800
    const len = kind === 'hat' ? 0.035 : 0.12
    g.gain.setValueAtTime(kind === 'hat' ? 0.05 : 0.14, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + len)
    src.connect(filter).connect(g)
    // Start at a random place in the noise so hits differ a little.
    src.start(time, (time * 7.31) % 0.5)
    src.stop(time + len + 0.02)
  }
}

let shared: AudioEngine | undefined

/** The app-wide engine. */
export function audioEngine(): AudioEngine {
  shared ??= new AudioEngine()
  return shared
}

/** Tests only: replace the shared engine. */
export function setAudioEngineForTests(engine: AudioEngine | undefined): void {
  shared = engine
}
