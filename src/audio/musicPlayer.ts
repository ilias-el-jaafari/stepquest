import { applyOps, kickEnvelope, noiseHitEnvelope, toneEnvelope } from './automation.ts'
import { calmEvents, LEVELS, midiToHz, nextBarStep, type Drum, type NoteEvent } from './chiptune.ts'
import { gateMusic, release, type Graph } from './graph.ts'
import { LOOKAHEAD_S, scheduleWindow, type ClockState } from './scheduler.ts'
import { musicAudible, type AudioSettings } from './settings.ts'
import { glideTempo, MENU_BPM, sanitizeBpm } from './tempo.ts'
import { monotonicNow } from './voiceQueue.ts'

/**
 * The music side of the engine: a 25 ms timer that asks the look-ahead
 * scheduler which sixteenth notes are due, and plays them on the audio clock.
 * Two modes: calm planning-screen music at a steady tempo ("menu") and the
 * quest tune that follows the walking pace ("quest"). Switching between them
 * glides the tempo and changes tune at the next bar line.
 *
 * The tune (`theme.ts`) is loaded with a dynamic import the first time the
 * music is audible. While it is not audible (muted, voice only, "Chiptune
 * music" off, volume zero) or the page is hidden, no timer runs.
 */

export type MusicState = 'off' | 'playing' | 'paused'
export type MusicMode = 'menu' | 'quest'

export type MusicDeps = {
  graph: () => Graph | undefined
  settings: () => AudioSettings
  /** The page is hidden: the music pauses until it is visible again. */
  hidden: () => boolean
  emit: () => void
}

type Theme = typeof import('./theme.ts')
let theme: Theme | undefined
let themeLoading: Promise<void> | undefined

/** Start loading the composed loop (once). Resolves when it is ready; a failed load can be retried. */
export function themeReady(): Promise<void> {
  themeLoading ??= import('./theme.ts').then(
    (m) => {
      theme = m
    },
    () => {
      themeLoading = undefined
    },
  )
  return themeLoading
}

/** Tests only: forget the loaded theme. */
export function resetThemeForTests(): void {
  theme = undefined
  themeLoading = undefined
}

/** Whether the lazily loaded theme has arrived. */
export function themeLoaded(): boolean {
  return theme !== undefined
}

const TICK_MS = 25
/** Seed of the planning-screen tune. */
const MENU_SEED = 2026

export class MusicPlayer {
  state: MusicState = 'off'
  mode: MusicMode = 'quest'
  private timer: ReturnType<typeof setInterval> | undefined
  private clock: ClockState = { nextTime: 0, step: 0 }
  private seed = 1
  private bpm = 104
  private targetBpm: number | undefined = undefined
  private lastTick = 0
  private pauseAt = 0
  /** The page is hidden: nothing is scheduled and the gate is closed. */
  private pageIsHidden = false
  /** A new tune waiting for the next bar line (smooth switch between menu and quest). */
  private pending: { seed: number; atStep: number } | undefined
  private readonly deps: MusicDeps

  constructor(deps: MusicDeps) {
    this.deps = deps
  }

  get tempo(): number {
    return this.bpm
  }

  /**
   * Calm planning-screen music at a steady tempo. Audible once audio is
   * unlocked by a tap. If a quest tune is playing it glides down and switches at the next bar.
   */
  playMenu(): void {
    this.mode = 'menu'
    if (this.state === 'playing') {
      this.switchTune(MENU_SEED)
      this.targetBpm = MENU_BPM
    } else {
      this.seed = MENU_SEED
      this.pending = undefined
      this.clock = { nextTime: 0, step: 0 }
      this.bpm = MENU_BPM
      this.targetBpm = MENU_BPM
      this.lastTick = 0
      this.state = 'playing'
      gateMusic(this.deps.graph(), !this.pageIsHidden)
    }
    this.refresh()
    this.deps.emit()
  }

  /**
   * Start the quest chiptune, which follows the walking pace (paused until a
   * walking tempo arrives). Coming from the menu music, it keeps playing at
   * the calm tempo, changes tune at the next bar and then follows the pace.
   */
  start(seed: number): void {
    const fromMenu = this.mode === 'menu' && this.state === 'playing'
    this.mode = 'quest'
    if (fromMenu) {
      this.switchTune(seed)
      this.refresh()
      this.deps.emit()
      return
    }
    this.pending = undefined
    this.seed = seed
    this.clock = { nextTime: 0, step: 0 }
    this.targetBpm = undefined
    this.state = 'paused'
    this.lastTick = 0
    this.refresh()
    this.deps.emit()
  }

  /** Walking tempo in BPM, or undefined (also for NaN and infinities) when standing still: the music fades out and waits. */
  setTempo(raw: number | undefined): void {
    if (this.state === 'off') return
    const bpm = sanitizeBpm(raw)
    const g = this.deps.graph()
    if (bpm !== undefined && this.targetBpm === undefined) {
      // Starting again: begin at the walking tempo rather than gliding up from the old one.
      if (this.state === 'paused') {
        this.bpm = bpm
        if (g) this.clock = { nextTime: g.ctx.currentTime + 0.05, step: this.clock.step }
      }
      this.state = 'playing'
      gateMusic(g, !this.pageIsHidden)
    } else if (bpm === undefined && this.targetBpm !== undefined) {
      gateMusic(g, false)
      this.pauseAt = monotonicNow() + 1500
    }
    this.targetBpm = bpm
    this.refresh()
    this.deps.emit()
  }

  stop(): void {
    this.clearTimer()
    this.state = 'off'
    this.targetBpm = undefined
    this.pending = undefined
    gateMusic(this.deps.graph(), false)
    this.deps.emit()
  }

  /** A new audio graph exists (first unlock, or a replacement for a closed context): open the gate and restart the clock. */
  graphReady(): void {
    this.clock = { nextTime: 0, step: this.clock.step }
    this.lastTick = 0
    if (this.state === 'playing') gateMusic(this.deps.graph(), !this.pageIsHidden)
    this.refresh()
  }

  /** The page was hidden: fade out and stop scheduling until it is visible again. */
  pageHidden(): void {
    if (this.pageIsHidden) return
    this.pageIsHidden = true
    if (this.state !== 'off') gateMusic(this.deps.graph(), false)
    this.refresh()
  }

  /** The page is visible again: resume at the same place in the loop, with no burst of missed notes. */
  pageVisible(): void {
    if (!this.pageIsHidden) return
    this.pageIsHidden = false
    this.clock = { nextTime: 0, step: this.clock.step }
    this.lastTick = 0
    if (this.state === 'playing') gateMusic(this.deps.graph(), true)
    this.refresh()
  }

  /**
   * Settings, visibility or state changed: run the timer only while there is something to hear.
   * While it is idle the app does no music work at all.
   */
  refresh(): void {
    const audible = musicAudible(this.deps.settings())
    if (this.state === 'off' || !audible || this.pageIsHidden) {
      this.clearTimer()
      return
    }
    // Back from silence: re-open the gate for what should be playing, and restart the clock now.
    if (!this.timer) {
      this.clock = { nextTime: 0, step: this.clock.step }
      this.lastTick = 0
      if (this.state === 'playing') gateMusic(this.deps.graph(), true)
      this.timer = setInterval(() => this.tick(), TICK_MS)
    }
  }

  private clearTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private switchTune(seed: number): void {
    if (seed === this.seed && !this.pending) return
    this.pending = { seed, atStep: nextBarStep(this.clock.step) }
  }

  private tick(): void {
    if (this.deps.hidden()) return this.pageHidden()
    const g = this.deps.graph()
    if (!g || g.ctx.state !== 'running') return
    if (!theme) {
      // First audible tick: fetch the composed loop. Nothing plays until it arrives.
      void themeReady()
      return
    }
    const now = g.ctx.currentTime
    const dt = this.lastTick ? now - this.lastTick : 0
    this.lastTick = now
    if (this.targetBpm === undefined) {
      if (this.state === 'playing' && monotonicNow() >= this.pauseAt) {
        this.state = 'paused'
        this.deps.emit()
      }
      if (this.state === 'paused') return
    } else this.bpm = glideTempo(this.bpm, this.targetBpm, dt)
    const { steps, state } = scheduleWindow(this.clock, now, LOOKAHEAD_S, this.bpm)
    this.clock = state
    const calm = this.mode === 'menu'
    for (const s of steps) {
      if (this.pending && s.step >= this.pending.atStep) {
        this.seed = this.pending.seed
        this.pending = undefined
      }
      const raw = theme.themeEventsAt(this.seed, s.step)
      const ev = calm ? calmEvents(raw) : raw
      if (ev.lead) this.tone(g, 'pulse250', ev.lead, s.time, s.duration, LEVELS.lead)
      if (ev.arp) this.tone(g, 'pulse125', ev.arp, s.time, s.duration, LEVELS.arp)
      if (ev.bass) this.tone(g, 'triangle', ev.bass, s.time, s.duration, LEVELS.bass)
      if (ev.drum) this.drum(g, ev.drum, s.time)
    }
  }

  private tone(g: Graph, wave: string, note: NoteEvent, time: number, stepDur: number, level: number): void {
    const osc = g.ctx.createOscillator()
    if (wave === 'triangle') osc.type = 'triangle'
    else osc.setPeriodicWave(g.waves.get(wave)!)
    osc.frequency.value = midiToHz(note.midi)
    const gain = g.ctx.createGain()
    const end = time + note.steps * stepDur * 0.92
    applyOps(gain.gain, toneEnvelope(level, time, end))
    osc.connect(gain).connect(g.gate)
    osc.start(time)
    osc.stop(end + 0.08)
    osc.onended = () => release(osc, gain)
  }

  private drum(g: Graph, kind: Drum, time: number): void {
    const ctx = g.ctx
    const gain = ctx.createGain()
    gain.connect(g.gate)
    if (kind === 'kick') {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(160, time)
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.12)
      applyOps(gain.gain, kickEnvelope(time, LEVELS.kick))
      osc.connect(gain)
      osc.start(time)
      osc.stop(time + 0.16)
      osc.onended = () => release(osc, gain)
      return
    }
    const src = ctx.createBufferSource()
    src.buffer = g.noise
    const filter = ctx.createBiquadFilter()
    filter.type = kind === 'hat' ? 'highpass' : 'bandpass'
    filter.frequency.value = kind === 'hat' ? 7000 : 1800
    const len = kind === 'hat' ? 0.035 : 0.12
    applyOps(gain.gain, noiseHitEnvelope(kind === 'hat' ? LEVELS.hat : LEVELS.snare, time, len))
    src.connect(filter).connect(gain)
    // Start at a random place in the noise so hits differ a little.
    src.start(time, (time * 7.31) % 0.5)
    src.stop(time + len + 0.02)
    src.onended = () => release(src, filter, gain)
  }
}
