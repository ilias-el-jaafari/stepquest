/**
 * A small fake of the Web Audio API for tests: it records what is scheduled
 * (oscillator starts with their frequencies, buffer sources, parameter events)
 * and lets a test move the clock. Used by the music, jingle and demo tests.
 */

export type ParamEvent = { kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel'; value: number; time: number }

export class FakeParam {
  value = 1
  events: ParamEvent[] = []
  setValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ kind: 'set', value, time })
    return this
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'linear', value, time })
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'exp', value, time })
    return this
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value
    this.events.push({ kind: 'target', value, time })
    return this
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: 0, time })
    return this
  }
}

export class FakeNode {
  disconnected = 0
  connections: unknown[] = []
  connect<T>(n: T): T {
    this.connections.push(n)
    return n
  }
  disconnect() {
    this.disconnected++
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam()
}

export type FakeOsc = FakeNode & { type: string; frequency: FakeParam; wave: boolean; startedAt: number | undefined; stoppedAt: number | undefined; onended: (() => void) | null }

export class FakeContext {
  static instances: FakeContext[] = []
  state: AudioContextState = 'suspended'
  currentTime = 0
  sampleRate = 48000
  destination = new FakeNode()
  onstatechange: (() => void) | null = null
  oscillators: FakeOsc[] = []
  sources: { startedAt: number | undefined; connections: unknown[] }[] = []
  gains: FakeGain[] = []
  suspended = 0
  resumed = 0
  constructor() {
    FakeContext.instances.push(this)
  }
  resume() {
    this.resumed++
    this.state = 'running'
    this.onstatechange?.()
    return Promise.resolve()
  }
  suspend() {
    this.suspended++
    this.state = 'suspended'
    this.onstatechange?.()
    return Promise.resolve()
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator() {
    const osc = Object.assign(new FakeNode(), {
      type: 'sine',
      frequency: new FakeParam(),
      wave: false,
      startedAt: undefined as number | undefined,
      stoppedAt: undefined as number | undefined,
      onended: null as (() => void) | null,
      setPeriodicWave() {
        osc.wave = true
      },
      start(t = 0) {
        osc.startedAt = t
      },
      stop(t = 0) {
        osc.stoppedAt = t
      },
    }) as unknown as FakeOsc
    this.oscillators.push(osc)
    return osc
  }
  createBufferSource() {
    const src = Object.assign(new FakeNode(), {
      buffer: null as unknown,
      startedAt: undefined as number | undefined,
      onended: null as (() => void) | null,
      start(t = 0) {
        src.startedAt = t
      },
      stop() {},
    })
    this.sources.push(src)
    return src
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
  createPeriodicWave() {
    return {}
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam() })
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() })
  }
  /** Tests: the oscillators started in a time range, as [start, hz]. */
  starts(from = -Infinity, to = Infinity): [number, number][] {
    return this.oscillators.filter((o) => o.startedAt !== undefined && o.startedAt >= from && o.startedAt < to).map((o) => [o.startedAt!, o.frequency.value])
  }
}

/** A window object with an AudioContext constructor and a controllable page visibility. */
export function fakeWindow() {
  let visibility: 'visible' | 'hidden' = 'visible'
  const listeners = new Map<string, Set<() => void>>()
  const doc = {
    get visibilityState() {
      return visibility
    },
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  }
  const win = { AudioContext: FakeContext, navigator: {}, document: doc, addEventListener: () => {} } as unknown as Window & typeof globalThis
  return {
    win,
    /** Dispatch a document event (for example `pointerup`, the first tap). */
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn()
    },
    setVisibility(v: 'visible' | 'hidden') {
      visibility = v
      for (const fn of listeners.get('visibilitychange') ?? []) fn()
    },
  }
}
