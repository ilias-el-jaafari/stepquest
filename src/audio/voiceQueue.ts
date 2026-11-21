/**
 * Which phrase plays next. Pure bookkeeping for the voice player: one phrase
 * at a time, a short queue, stale phrases dropped, and an urgent phrase
 * (higher priority than the one playing, by 2 or more) cuts in.
 */
export type QueuedPhrase = { text: string; priority: number; at: number }

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
    if (this.playing?.text === p.text || this.queue.some((q) => q.text === p.text)) return 'dropped'
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

  get size(): number {
    return this.queue.length
  }
}
