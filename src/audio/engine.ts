import type { Locale } from '../i18n/locale.ts'
import { applyBusGains, createGraph, duckMusic, type Graph } from './graph.ts'
import { playEffect } from './effects.ts'
import { armOnGesture, configureAudioSession, installRecovery, playSilentUnlock } from './lifecycle.ts'
import { MusicPlayer, type MusicMode } from './musicPlayer.ts'
import { busGains, loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings.ts'
import type { SfxName } from './sfx.ts'
import type { SpokenPhrase } from './speechBubble.ts'
import { VoicePlayer } from './voicePlayer.ts'

/**
 * The audio engine: one object for the app, a thin facade over
 *
 * - `graph.ts`        buses, pulse waves, noise (created in a user gesture)
 * - `voicePlayer.ts`  phrase queue, speech, speech bubble, cache
 * - `musicPlayer.ts`  chiptune scheduling and tempo
 * - `effects.ts`      sound effects
 * - `lifecycle.ts`    unlocking and recovery listeners
 *
 * The AudioContext is only created inside a user gesture (`unlock`), as iOS
 * Safari requires, and is resumed after interruptions (calls, Siri, locking the
 * phone) on the next tap or when the page becomes visible again. A context the
 * system has closed is replaced on the next tap.
 */

export { lfsrNoise, pulseCoefficients } from './graph.ts'
export type { MusicMode } from './musicPlayer.ts'

export type EngineStatus = 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed'
export type EngineSnapshot = { settings: AudioSettings; status: EngineStatus; music: 'off' | 'playing' | 'paused'; musicMode: MusicMode; speaking: boolean; phrase: SpokenPhrase | undefined }

type Ctor = typeof AudioContext
type Win = Window & typeof globalThis

export class AudioEngine {
  private graph: Graph | undefined
  private settings: AudioSettings
  private snapshot: EngineSnapshot
  private listeners = new Set<() => void>()
  private recoveryInstalled = false
  private cancelArm: (() => void) | undefined
  private readonly win: Win | undefined
  private readonly voice: VoicePlayer
  private readonly music: MusicPlayer

  constructor(settings: AudioSettings = loadAudioSettings(), win: Win | undefined = typeof window === 'undefined' ? undefined : window) {
    this.settings = settings
    this.win = win
    this.snapshot = { settings, status: 'locked', music: 'off', musicMode: 'quest', speaking: false, phrase: undefined }
    this.voice = new VoicePlayer({
      graph: () => this.graph,
      canSpeak: () => this.canSpeak(),
      emit: () => this.emit(),
    })
    this.music = new MusicPlayer({
      graph: () => this.graph,
      settings: () => this.settings,
      hidden: () => this.win?.document.visibilityState === 'hidden',
      emit: () => this.emit(),
    })
  }

  // ---- state for React (useSyncExternalStore) ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  private emit() {
    const status: EngineStatus = !this.graph ? 'locked' : (this.graph.ctx.state as EngineStatus)
    this.snapshot = { settings: this.settings, status, music: this.music.state, musicMode: this.music.mode, speaking: this.voice.speaking, phrase: this.voice.phrase }
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
    if (this.graph) applyBusGains(this.graph, this.settings)
    if (this.settings.muted) this.voice.stop()
    else this.voice.contextChanged()
    this.emit()
  }

  // ---- unlocking and recovery ----

  /** Call from a click/tap handler. Creates (or, if the system closed it, replaces) and resumes the AudioContext. */
  unlock(): void {
    const C = this.ctor()
    if (!C) return
    this.cancelArm?.()
    this.cancelArm = undefined
    if (this.graph?.ctx.state === 'closed') this.dropGraph()
    if (!this.graph) {
      if (this.win) configureAudioSession(this.win)
      const ctx = new C({ latencyHint: 'interactive' })
      this.graph = createGraph(ctx)
      ctx.onstatechange = () => {
        if (this.graph?.ctx !== ctx) return
        this.voice.contextChanged()
        this.emit()
        if (ctx.state !== 'running' && ctx.state !== 'closed' && this.win?.document.visibilityState === 'visible') void ctx.resume().catch(() => {})
      }
      applyBusGains(this.graph, this.settings)
      // Music asked for before the first tap (planning screen) fades in now.
      this.music.graphReady()
      this.installRecovery()
    }
    const ctx = this.graph.ctx
    if (ctx.state !== 'running') void ctx.resume().catch(() => {})
    playSilentUnlock(ctx)
    this.emit()
  }

  /**
   * Unlock on the next tap or key press anywhere (used when a saved quest is
   * resumed after a reload, which happens without a gesture).
   */
  armUnlock(): void {
    if (this.graph || !this.win || this.cancelArm) return
    this.cancelArm = armOnGesture(this.win, () => {
      this.cancelArm = undefined
      this.unlock()
    })
  }

  /** Forget a closed context. The voice shows its phrase silently; the music waits for the new graph. */
  private dropGraph() {
    this.voice.contextChanged()
    this.graph = undefined
  }

  private installRecovery() {
    if (this.recoveryInstalled || !this.win) return
    this.recoveryInstalled = true
    installRecovery(this.win, () => {
      const ctx = this.graph?.ctx
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().then(() => this.emit(), () => {})
    })
  }

  // ---- sound effects ----

  playSfx(name: SfxName): void {
    const g = this.graph
    if (!g || g.ctx.state !== 'running') return
    if (busGains(this.settings).sfx <= 0) return
    playEffect(g, name)
  }

  // ---- voice ----

  /**
   * Speak a phrase (already translated). Higher priority phrases cut in on lower ones.
   * Without a running, audible voice the phrase still goes through the same queue
   * and is only shown (as a bubble) for a time based on its length.
   */
  say(text: string, locale: Locale, priority = 1): void {
    this.voice.say(text, locale, priority)
  }

  /** Render phrases that will probably be needed (distance marks, turns) while the app is idle. */
  prewarm(texts: readonly string[], locale: Locale): void {
    this.voice.prewarm(texts, locale)
  }

  stopVoice(): void {
    this.voice.stop()
  }

  private canSpeak(): boolean {
    const g = this.graph
    return !!g && g.ctx.state === 'running' && !this.settings.muted && busGains(this.settings).voice > 0
  }

  // ---- music ----

  playMenuMusic(): void {
    this.music.playMenu()
  }

  startMusic(seed: number): void {
    this.music.start(seed)
  }

  /** Walking tempo in BPM, or undefined when standing still (the music fades out and waits). */
  setTempo(bpm: number | undefined): void {
    this.music.setTempo(bpm)
  }

  stopMusic(): void {
    this.music.stop()
  }

  get tempo(): number {
    return this.music.tempo
  }

  /** Counters of the voice player (phrases rendered, failures, watchdog firings), for tests and tuning. */
  get voiceStats(): Readonly<VoicePlayer['stats']> {
    return this.voice.stats
  }

  /** Tests and teardown: stop every timer. */
  dispose(): void {
    this.music.stop()
    this.voice.dispose()
    duckMusic(this.graph, false)
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
