import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, lfsrNoise, pulseCoefficients } from './engine.ts'
import { AUDIO_STORAGE_KEY, DEFAULT_AUDIO } from './settings.ts'

/** Just enough of the Web Audio API to watch what the engine does. */
class FakeParam {
  value = 1
  targets: number[] = []
  setValueAtTime(v: number) {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number) {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v
    return this
  }
  setTargetAtTime(v: number) {
    this.targets.push(v)
    this.value = v
    return this
  }
  cancelScheduledValues() {
    return this
  }
}

class FakeNode {
  connect<T>(n: T): T {
    return n
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeContext {
  static instances: FakeContext[] = []
  state: AudioContextState = 'suspended'
  currentTime = 0
  sampleRate = 48000
  destination = new FakeNode()
  onstatechange: (() => void) | null = null
  oscillators = 0
  sources: { buffer: { length: number } | null; started: boolean; stop(): void; onended: (() => void) | null }[] = []
  buffers = 0
  constructor() {
    FakeContext.instances.push(this)
  }
  resume() {
    this.state = 'running'
    this.onstatechange?.()
    return Promise.resolve()
  }
  createGain() {
    return new FakeGain()
  }
  createOscillator() {
    this.oscillators++
    const osc = Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), setPeriodicWave() {}, start() {}, stop() {} })
    return osc
  }
  createBufferSource() {
    const src = Object.assign(new FakeNode(), {
      buffer: null as { length: number } | null,
      started: false,
      onended: null as (() => void) | null,
      start() {
        src.started = true
      },
      stop() {},
    })
    this.sources.push(src)
    return src
  }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    this.buffers++
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
  createPeriodicWave() {
    return {}
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam() })
  }
}

function fakeWindow(): Window & typeof globalThis {
  return { AudioContext: FakeContext, navigator: {}, document, addEventListener: () => {} } as unknown as Window & typeof globalThis
}

beforeEach(() => {
  localStorage.clear()
  FakeContext.instances = []
})
afterEach(() => vi.useRealTimers())

describe('audio engine', () => {
  it('stays silent and creates no AudioContext until a user gesture unlocks it', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.say('Hello', 'en')
    engine.playSfx('gem')
    engine.startMusic(1)
    expect(FakeContext.instances).toHaveLength(0)
    expect(engine.getSnapshot().status).toBe('locked')
    engine.unlock()
    expect(FakeContext.instances).toHaveLength(1)
    expect(engine.getSnapshot().status).toBe('running')
    engine.unlock()
    expect(FakeContext.instances).toHaveLength(1)
    engine.stopMusic()
  })

  it('after a reload, waits for the first tap anywhere before creating audio', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.armUnlock()
    expect(FakeContext.instances).toHaveLength(0)
    document.dispatchEvent(new Event('pointerup'))
    expect(FakeContext.instances).toHaveLength(1)
    document.dispatchEvent(new Event('pointerup'))
    expect(FakeContext.instances).toHaveLength(1)
  })

  it('is a no-op when the browser has no Web Audio', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, { navigator: {}, document } as unknown as Window & typeof globalThis)
    expect(engine.supported).toBe(false)
    engine.unlock()
    engine.say('Hello', 'en')
    expect(engine.getSnapshot().status).toBe('locked')
  })

  it('persists settings and applies them to the buses', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getSnapshot().settings.muted ? 'muted' : 'on'))
    engine.updateSettings({ muted: true })
    expect(JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY)!).muted).toBe(true)
    expect(seen).toEqual(['muted'])
    engine.updateSettings({ muted: false, music: 0.3 })
    expect(JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY)!).music).toBe(0.3)
  })

  it('renders speech once, plays phrases one after another and skips them when muted', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    const before = ctx.sources.length
    engine.say('Back on route.', 'en', 2)
    engine.say('Well done!', 'en', 1)
    const voice = ctx.sources.slice(before)
    expect(voice).toHaveLength(1)
    expect(voice[0]!.buffer!.length).toBeGreaterThan(10_000)
    expect(engine.getSnapshot().speaking).toBe(true)
    voice[0]!.onended?.()
    expect(ctx.sources.length - before).toBe(2)
    ctx.sources[ctx.sources.length - 1]!.onended?.()
    expect(engine.getSnapshot().speaking).toBe(false)
    // The same phrase again comes from the cache.
    const buffers = ctx.buffers
    engine.say('Back on route.', 'en', 2)
    expect(ctx.buffers).toBe(buffers)
    engine.updateSettings({ muted: true })
    const n = ctx.sources.length
    engine.say('Something else.', 'en', 3)
    expect(ctx.sources.length).toBe(n)
  })

  it('plays music only while walking, following the tempo, and pauses when stopped', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.startMusic(42)
    expect(engine.getSnapshot().music).toBe('paused')
    const run = (ms: number) => {
      for (let i = 0; i < ms / 25; i++) {
        ctx.currentTime += 0.025
        vi.advanceTimersByTime(25)
      }
    }
    run(500)
    expect(ctx.oscillators).toBe(0) // standing still: nothing scheduled
    engine.setTempo(110)
    expect(engine.getSnapshot().music).toBe('playing')
    expect(engine.tempo).toBe(110)
    run(1000)
    const playing = ctx.oscillators
    expect(playing).toBeGreaterThan(10)
    engine.setTempo(130)
    run(1000)
    expect(engine.tempo).toBeGreaterThan(110)
    expect(engine.tempo).toBeLessThan(130) // glides, no jump
    engine.setTempo(undefined)
    run(2000)
    expect(engine.getSnapshot().music).toBe('paused')
    const paused = ctx.oscillators
    run(1000)
    expect(ctx.oscillators).toBe(paused)
    engine.stopMusic()
    expect(engine.getSnapshot().music).toBe('off')
  })

  it('builds band-limited pulse waves and chip-style noise', () => {
    const half = pulseCoefficients(0.5, 8)
    expect(half.real[2]).toBeCloseTo(0) // a square wave has no even harmonics
    expect(half.real[1]).toBeCloseTo(2 / Math.PI)
    const quarter = pulseCoefficients(0.25, 8)
    expect(Math.abs(quarter.real[2]!)).toBeGreaterThan(0.1)
    const noise = lfsrNoise(1000)
    expect(new Set(noise).size).toBe(2)
    expect(noise.filter((v) => v > 0).length).toBeGreaterThan(300)
  })
})
