import type { Locale } from '../i18n/locale.ts'
import { fadeTo } from './automation.ts'
import { duckMusic, release, type Graph } from './graph.ts'
import { bubbleDurationMs, type SpokenPhrase } from './speechBubble.ts'
import { limitSpokenText } from './voice/text.ts'
import { renderText } from './voice/synth.ts'
import { monotonicNow, VoiceQueue, type QueuedPhrase } from './voiceQueue.ts'

/**
 * The voice side of the engine: the phrase queue, playback, the phrase on air
 * (which the map draws as a speech bubble), the synthesis cache and pre-rendering.
 *
 * Rules:
 * - Every phrase goes through the queue, spoken or not. The bubble is the phrase
 *   on air and nothing else (`phrase`), so bubble and voice cannot disagree.
 * - A phrase leaves the air in one place, `finish`: its source ended, its silent
 *   time ran out, or the watchdog fired. A cut-in or `stop` replaces or clears it.
 * - Nothing the browser does (a failing synthesis, a context that is interrupted,
 *   closed or never reports `ended`) can leave the queue blocked.
 */

export const VOICE_RATE = 22050
/** Spoken phrases are kept as samples up to this many bytes. */
export const CACHE_BYTES = 8 * 1024 * 1024
/** A source that has not reported its end this long after it should have is given up. */
export const WATCHDOG_MS = 1500
/** Fade-out of a phrase that is cut in or muted. */
export const FADE_S = 0.015

export type VoiceDeps = {
  graph: () => Graph | undefined
  /** True when the context runs and the voice is neither muted nor at zero volume. */
  canSpeak: () => boolean
  /** The state shown to React changed. */
  emit: () => void
  now?: () => number
}

type OnAir = { src: AudioBufferSourceNode; gain: GainNode }

export class VoicePlayer {
  private readonly queue = new VoiceQueue()
  private onAir: OnAir | undefined
  private current: SpokenPhrase | undefined
  private phraseId = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private cache = new Map<string, Float32Array>()
  private cacheBytes = 0
  private warmList: { text: string; locale: Locale }[] = []
  private warmTimer: ReturnType<typeof setTimeout> | undefined
  private readonly deps: VoiceDeps
  /** Counters for tests and tuning. */
  readonly stats = { rendered: 0, failures: 0, watchdog: 0 }

  constructor(deps: VoiceDeps) {
    this.deps = deps
  }

  /** The phrase on air (spoken or shown silently), or undefined. */
  get phrase(): SpokenPhrase | undefined {
    return this.current
  }

  get speaking(): boolean {
    return !!this.onAir
  }

  private now(): number {
    return (this.deps.now ?? monotonicNow)()
  }

  /** Queue a phrase (already translated). Higher priorities cut in on lower ones. */
  say(text: string, locale: Locale, priority = 1): void {
    const clean = limitSpokenText(text)
    if (!clean) return
    const action = this.queue.push({ text: clean, locale, priority, at: this.now() })
    if (action === 'interrupt') {
      this.cut()
      this.start(this.queue.playing!)
    } else if (action === 'play') this.start(this.queue.playing!)
    else return
    this.deps.emit()
  }

  /** Silence everything: the phrase on air, the queue and the bubble. */
  stop(): void {
    this.cut()
    this.queue.clear()
    const had = this.current !== undefined
    this.current = undefined
    duckMusic(this.deps.graph(), false)
    if (had) this.deps.emit()
  }

  /** The audio context changed state: a phrase on a context that no longer runs continues as a silent bubble. */
  contextChanged(): void {
    if (!this.onAir || this.deps.canSpeak()) return
    this.cut()
    if (this.current) this.showSilently(this.current.text)
    this.deps.emit()
  }

  /** Render phrases ahead of time, one per timer slot and never while one is on air. */
  prewarm(texts: readonly string[], locale: Locale): void {
    for (const raw of texts) {
      const text = limitSpokenText(raw)
      if (text && !this.cache.has(`${locale}|${text}`) && !this.warmList.some((w) => w.text === text && w.locale === locale)) this.warmList.push({ text, locale })
    }
    this.warmList.splice(0, Math.max(0, this.warmList.length - 32))
    this.scheduleWarm(0)
  }

  /** Cancel timers (tests, teardown). */
  dispose(): void {
    this.stop()
    clearTimeout(this.warmTimer)
    this.warmTimer = undefined
    this.warmList = []
  }

  // ---- playing ----

  private start(p: QueuedPhrase): void {
    this.current = { id: ++this.phraseId, text: p.text }
    if (this.deps.canSpeak()) {
      try {
        this.speak(p)
        return
      } catch {
        this.stats.failures++
        this.cut()
      }
    }
    this.showSilently(p.text)
  }

  private speak(p: QueuedPhrase): void {
    const g = this.deps.graph()!
    const samples = this.samplesFor(p.text, p.locale)
    const buffer = g.ctx.createBuffer(1, samples.length, VOICE_RATE)
    buffer.getChannelData(0).set(samples)
    const src = g.ctx.createBufferSource()
    const gain = g.ctx.createGain()
    src.buffer = buffer
    src.connect(gain)
    gain.connect(g.voice)
    src.onended = () => {
      if (this.onAir?.src !== src) return
      this.finish(true)
    }
    this.onAir = { src, gain }
    duckMusic(g, true)
    src.start(g.ctx.currentTime + 0.02)
    // If `ended` never comes (interrupted or closed context), give the phrase up a little after its length.
    this.timer = setTimeout(() => {
      this.stats.watchdog++
      this.finish()
    }, (samples.length / VOICE_RATE) * 1000 + 20 + WATCHDOG_MS)
  }

  private showSilently(text: string): void {
    duckMusic(this.deps.graph(), false)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.finish(), bubbleDurationMs(text))
  }

  /** The phrase on air is over: play the next one, or clear the bubble. */
  private finish(ended = false): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (ended) {
      // The source played to its end: nothing to stop, just let go of the nodes.
      release(this.onAir?.src, this.onAir?.gain)
      this.onAir = undefined
    } else this.cut()
    const next = this.queue.next(this.now())
    if (next) this.start(next)
    else {
      this.current = undefined
      duckMusic(this.deps.graph(), false)
    }
    this.deps.emit()
  }

  /** Stop the source (with a short fade, no click) and cancel the timer. */
  private cut(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const a = this.onAir
    this.onAir = undefined
    if (!a) return
    a.src.onended = () => release(a.src, a.gain)
    try {
      const g = this.deps.graph()
      if (g) {
        fadeTo(a.gain.gain, 0, g.ctx.currentTime, FADE_S)
        a.src.stop(g.ctx.currentTime + FADE_S + 0.005)
      } else a.src.stop()
    } catch {
      // never started or already stopped
      release(a.src, a.gain)
    }
  }

  // ---- synthesis cache ----

  private samplesFor(text: string, locale: Locale): Float32Array {
    const key = `${locale}|${text}`
    let samples = this.cache.get(key)
    if (samples) {
      // Refresh its place in the LRU.
      this.cache.delete(key)
      this.cache.set(key, samples)
      return samples
    }
    samples = renderText(text, locale, { sampleRate: VOICE_RATE })
    this.stats.rendered++
    this.cache.set(key, samples)
    this.cacheBytes += samples.byteLength
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= CACHE_BYTES || this.cache.size <= 1) break
      this.cache.delete(k)
      this.cacheBytes -= v.byteLength
    }
    return samples
  }

  private scheduleWarm(delay: number): void {
    if (this.warmTimer || !this.warmList.length) return
    this.warmTimer = setTimeout(() => {
      this.warmTimer = undefined
      // Never compete with a phrase that is being spoken or about to be.
      if (this.current) {
        this.scheduleWarm(250)
        return
      }
      const next = this.warmList.shift()
      if (next) {
        try {
          this.samplesFor(next.text, next.locale)
        } catch {
          this.stats.failures++
        }
      }
      this.scheduleWarm(30)
    }, delay)
  }
}
