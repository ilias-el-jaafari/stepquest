import type { Locale } from '../i18n/locale.ts'

/**
 * Which phrase plays next. Pure bookkeeping for the voice player: one phrase
 * at a time, a short queue, stale phrases dropped, and an urgent phrase
 * (higher priority than the one playing, by 2 or more) cuts in.
 *
 * Invariants (property P-V4): at most one phrase plays; the queue never holds
 * more than `maxQueue` phrases or the same phrase twice; `next` hands out the
 * highest priority first, then the oldest; a phrase older than `maxAgeMs` is
 * never handed out, unless its priority is 5 or more (the finish).
 * A phrase carries its own language: the queue outlives a language switch.
 */
export type QueuedPhrase = { text: string; locale: Locale; priority: number; /** Arrival time on the monotonic clock (ms). */ at: number }

/** Milliseconds on a clock that never jumps back or forward with the device clock. */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const sameAs = (a: QueuedPhrase, b: QueuedPhrase) => a.text === b.text && a.locale === b.locale

export class VoiceQueue {
  private queue: QueuedPhrase[] = []
  playing: QueuedPhrase | undefined
  readonly maxQueue: number
  readonly maxAgeMs: number

  constructor(maxQueue = 3, maxAgeMs = 8000) {
    this.maxQueue = maxQueue
    this.maxAgeMs = maxAgeMs
  }

  /** Add a phrase. Returns 'play' (start it now), 'interrupt' (stop the current one first), or 'queued'/'dropped'. */
  push(p: QueuedPhrase): 'play' | 'interrupt' | 'queued' | 'dropped' {
    if (!p.text.trim()) return 'dropped'
    if (this.playing && sameAs(this.playing, p)) return 'dropped'
    // The same phrase already waits: keep the more important of the two (an urgent repeat must not be lost behind a low one).
    const twin = this.queue.findIndex((q) => sameAs(q, p))
    if (twin >= 0) {
      if (this.queue[twin]!.priority >= p.priority) return 'dropped'
      this.queue.splice(twin, 1)
    }
    if (!this.playing) {
      this.playing = p
      return 'play'
    }
    if (p.priority >= this.playing.priority + 2) {
      this.queue = this.queue.filter((q) => q.priority >= p.priority)
      this.playing = p
      return 'interrupt'
    }
    this.queue.push(p)
    // Keep the most important ones, oldest first among equals.
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at)
    if (this.queue.length > this.maxQueue) {
      const dropped = this.queue.pop()!
      return dropped === p ? 'dropped' : 'queued'
    }
    return 'queued'
  }

  /** The current phrase finished: what to play next (stale ones skipped). */
  next(now: number): QueuedPhrase | undefined {
    this.playing = undefined
    while (this.queue.length) {
      const p = this.queue.shift()!
      if (now - p.at <= this.maxAgeMs || p.priority >= 5) {
        this.playing = p
        return p
      }
    }
    return undefined
  }

  clear(): void {
    this.queue = []
    this.playing = undefined
  }

  /** The waiting phrases, in the order they will be played. */
  get waiting(): readonly QueuedPhrase[] {
    return this.queue
  }

  get size(): number {
    return this.queue.length
  }
}
