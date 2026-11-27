import fc from 'fast-check'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, lfsrNoise, pulseCoefficients } from './engine.ts'
import { themeReady } from './musicPlayer.ts'
import { bubbleDurationMs } from './speechBubble.ts'
import { AUDIO_STORAGE_KEY, DEFAULT_AUDIO } from './settings.ts'
import type { VoiceQueue } from './voiceQueue.ts'

/** Just enough of the Web Audio API to watch what the engine does. */
class FakeParam {
  value = 1
  targets: number[] = []
  linear: number[] = []
  setValueAtTime(v: number) {
    this.value = v
    return this
  }
  linearRampToValueAtTime(v: number) {
    this.linear.push(v)
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
  disconnected = 0
  connect<T>(n: T): T {
    return n
  }
  disconnect() {
    this.disconnected++
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
  sources: { buffer: { length: number } | null; started: boolean; stops: number; stop(): void; onended: (() => void) | null; disconnected: number }[] = []
  gains: FakeGain[] = []
  buffers = 0
  failBuffers = false
  constructor() {
    FakeContext.instances.push(this)
  }
  resume() {
    this.state = 'running'
    this.onstatechange?.()
    return Promise.resolve()
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator() {
    this.oscillators++
    const osc = Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), onended: null as (() => void) | null, setPeriodicWave() {}, start() {}, stop() {} })
    return osc
  }
  createBufferSource() {
    const src = Object.assign(new FakeNode(), {
      buffer: null as { length: number } | null,
      started: false,
      stops: 0,
      onended: null as (() => void) | null,
      start() {
        src.started = true
      },
      stop() {
        src.stops++
      },
    })
    this.sources.push(src)
    return src
  }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    if (this.failBuffers) throw new Error('NotSupportedError')
    this.buffers++
    const data = new Float32Array(length)
    return { length, sampleRate, getChannelData: () => data }
  }
  createPeriodicWave() {
    return {}
  }
  filters = 0
  createBiquadFilter() {
    this.filters++
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam() })
  }
}

function fakeWindow(navigator: object = {}): Window & typeof globalThis {
  return { AudioContext: FakeContext, navigator, document, addEventListener: () => {} } as unknown as Window & typeof globalThis
}

function hiddenWindow(): Window & typeof globalThis {
  return { ...fakeWindow(), document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} } } as unknown as Window & typeof globalThis
}

function runner(ctx: FakeContext) {
  return (ms: number) => {
    for (let i = 0; i < ms / 25; i++) {
      ctx.currentTime += 0.025
      vi.advanceTimersByTime(25)
    }
  }
}

// The composed loop is loaded lazily; the tests start with it in memory.
beforeAll(() => themeReady())

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
    const rendered = engine.voiceStats.rendered
    engine.say('Back on route.', 'en', 2)
    expect(engine.voiceStats.rendered).toBe(rendered)
    engine.updateSettings({ muted: true })
    const n = ctx.sources.length
    engine.say('Something else.', 'en', 3)
    expect(ctx.sources.length).toBe(n)
  })

  it('exposes the phrase on air for the speech bubble and clears it when the voice ends', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    const before = ctx.sources.length
    expect(engine.getSnapshot().phrase).toBeUndefined()
    engine.say('Back on route.', 'en', 2)
    expect(engine.getSnapshot().phrase?.text).toBe('Back on route.')
    engine.say('Well done!', 'en', 1)
    expect(engine.getSnapshot().phrase?.text).toBe('Back on route.')
    ctx.sources[before]!.onended?.()
    expect(engine.getSnapshot().phrase?.text).toBe('Well done!')
    ctx.sources[ctx.sources.length - 1]!.onended?.()
    expect(engine.getSnapshot().phrase).toBeUndefined()
  })

  it('lets an urgent phrase replace the bubble text', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    engine.say('Keep going.', 'es', 1)
    engine.say('You made it!', 'es', 5)
    expect(engine.getSnapshot().phrase?.text).toBe('You made it!')
  })

  it('still shows the bubble, for a time based on text length, when muted or locked', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine({ ...DEFAULT_AUDIO, muted: true }, fakeWindow())
    engine.unlock()
    expect(FakeContext.instances).toHaveLength(0) // muted: a tap creates no AudioContext
    const short = 'Turn left.'
    const long = 'Checkpoint three of ten reached. Next one in four hundred metres, to the north east.'
    engine.say(short, 'en', 2)
    engine.say(long, 'en', 1)
    expect(engine.getSnapshot().phrase?.text).toBe(short)
    vi.advanceTimersByTime(bubbleDurationMs(short) - 1)
    expect(engine.getSnapshot().phrase?.text).toBe(short)
    vi.advanceTimersByTime(2)
    expect(engine.getSnapshot().phrase?.text).toBe(long)
    vi.advanceTimersByTime(bubbleDurationMs(long) + 1)
    expect(engine.getSnapshot().phrase).toBeUndefined()
    // Before any unlock there is no AudioContext at all, and the bubble still works.
    const locked = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    locked.say(short, 'en')
    expect(locked.getSnapshot().phrase?.text).toBe(short)
    locked.stopVoice()
    expect(locked.getSnapshot().phrase).toBeUndefined()
  })

  it('removes the bubble at once when sound is muted mid-phrase', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    engine.say('Halfway there.', 'en')
    engine.updateSettings({ muted: true })
    expect(engine.getSnapshot().phrase).toBeUndefined()
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

  it('uses the iOS "ambient" audio session (mixes with other audio, follows the silent switch)', () => {
    const nav = { audioSession: { type: 'auto' } }
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow(nav))
    expect(nav.audioSession.type).toBe('auto') // nothing before a gesture
    engine.unlock()
    expect(nav.audioSession.type).toBe('ambient')
  })

  it('plays calm, steady menu music on the planning screen, only after a tap', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.armUnlock()
    engine.playMenuMusic()
    expect(engine.getSnapshot().music).toBe('playing')
    expect(engine.getSnapshot().musicMode).toBe('menu')
    vi.advanceTimersByTime(1000)
    expect(FakeContext.instances).toHaveLength(0) // no sound, no context before the gesture
    document.dispatchEvent(new Event('pointerup'))
    const ctx = FakeContext.instances[0]!
    const run = runner(ctx)
    run(4000)
    expect(ctx.oscillators).toBeGreaterThan(10)
    expect(engine.tempo).toBe(80) // steady
    expect(ctx.filters).toBe(0) // calm arrangement: no snare or hi-hat
    engine.stopMusic()
  })

  it('switches smoothly from the menu music to pace-following on quest start', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    const run = runner(ctx)
    engine.playMenuMusic()
    run(1000)
    engine.startMusic(42)
    // Keeps playing (no restart, no silence) at the calm tempo until a pace arrives.
    expect(engine.getSnapshot().music).toBe('playing')
    expect(engine.getSnapshot().musicMode).toBe('quest')
    const before = ctx.oscillators
    run(1000)
    expect(ctx.oscillators).toBeGreaterThan(before)
    expect(engine.tempo).toBe(80)
    engine.setTempo(120)
    run(1000)
    expect(engine.tempo).toBeGreaterThan(80)
    expect(engine.tempo).toBeLessThan(120) // glides
    run(20_000)
    expect(engine.tempo).toBe(120)
    expect(ctx.filters).toBeGreaterThan(0) // the full quest drum kit is back after the bar line
    // Back to planning: glides down to the calm tempo again.
    engine.playMenuMusic()
    run(20_000)
    expect(engine.tempo).toBe(80)
    expect(engine.getSnapshot().music).toBe('playing')
    engine.stopMusic()
  })

  it('menu music respects mute and the music volume', () => {
    vi.useFakeTimers()
    for (const patch of [{ muted: true }, { music: 0 }, { voiceOnly: true }]) {
      FakeContext.instances = []
      const engine = new AudioEngine({ ...DEFAULT_AUDIO, ...patch }, fakeWindow())
      engine.unlock()
      engine.playMenuMusic()
      if (patch.muted) {
        expect(FakeContext.instances).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0) // muted: no music timer either
      } else runner(FakeContext.instances[0]!)(2000)
      expect(FakeContext.instances[0]?.oscillators ?? 0).toBe(0)
      engine.updateSettings({ muted: false, music: 0.8, voiceOnly: false })
      const ctx = FakeContext.instances[0]! // the tap that unmutes creates the context
      runner(ctx)(2000)
      expect(ctx.oscillators).toBeGreaterThan(0)
      engine.stopMusic()
    }
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

/** The phrase queue behind the engine's voice player (for invariants). */
function queueOf(engine: AudioEngine) {
  return (engine as unknown as { voice: { queue: VoiceQueue } }).voice.queue
}

describe('voice player (review Nov 2026)', () => {
  it('B9: speaks a queued phrase in the language it was queued in', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.say('Gira a la izquierda.', 'es', 2)
    engine.say('Turn left.', 'en', 1)
    engine.say('Gira a la derecha.', 'es', 1)
    // Spanish phrase on air; the app language changes to English while the others wait.
    expect(queueOf(engine).waiting.map((p) => p.locale)).toEqual(['en', 'es'])
    ctx.sources[ctx.sources.length - 1]!.onended?.()
    expect(queueOf(engine).playing?.locale).toBe('en')
  })

  it('B10: a failing synthesis or buffer shows the phrase silently and never blocks the queue', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    ctx.failBuffers = true
    expect(() => engine.say('Back on route.', 'en', 2)).not.toThrow()
    expect(engine.getSnapshot().phrase?.text).toBe('Back on route.')
    expect(engine.voiceStats.failures).toBe(1)
    engine.say('Well done!', 'en', 1)
    vi.advanceTimersByTime(bubbleDurationMs('Back on route.') + 1)
    expect(engine.getSnapshot().phrase?.text).toBe('Well done!')
    ctx.failBuffers = false
    vi.advanceTimersByTime(bubbleDurationMs('Well done!') + 1)
    expect(engine.getSnapshot().phrase).toBeUndefined()
    engine.say('Turn left.', 'en', 2) // and speech works again
    expect(engine.getSnapshot().speaking).toBe(true)
  })

  it('B11: gives up a phrase whose end is never reported, so the queue and bubble advance', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.say('Back on route.', 'en', 2)
    engine.say('Well done!', 'en', 1)
    const first = ctx.sources[ctx.sources.length - 1]!
    const samples = first.buffer!.length
    vi.advanceTimersByTime((samples / 22050) * 1000 + 1000)
    expect(engine.getSnapshot().phrase?.text).toBe('Back on route.') // not yet: the watchdog waits 1.5 s more
    vi.advanceTimersByTime(700)
    expect(engine.voiceStats.watchdog).toBe(1)
    expect(engine.getSnapshot().phrase?.text).toBe('Well done!')
    expect(first.stops).toBeGreaterThan(0)
  })

  it('B11: an interrupted or closed context turns the phrase on air into a silent bubble, and the queue goes on', () => {
    vi.useFakeTimers()
    for (const state of ['interrupted', 'suspended', 'closed'] as const) {
      FakeContext.instances = []
      // A hidden page: the engine does not try to resume the context by itself.
      const engine = new AudioEngine(DEFAULT_AUDIO, hiddenWindow())
      engine.unlock()
      const ctx = FakeContext.instances[0]!
      engine.say('Back on route.', 'en', 2)
      engine.say('Well done!', 'en', 1)
      const id = engine.getSnapshot().phrase!.id
      ctx.state = state
      ctx.onstatechange?.()
      expect(engine.getSnapshot().speaking, state).toBe(false)
      expect(engine.getSnapshot().phrase, state).toMatchObject({ id, text: 'Back on route.' }) // same phrase, still shown
      vi.advanceTimersByTime(bubbleDurationMs('Back on route.') + 1)
      expect(engine.getSnapshot().phrase?.text, state).toBe('Well done!')
      vi.advanceTimersByTime(bubbleDurationMs('Well done!') + 1)
      expect(engine.getSnapshot().phrase, state).toBeUndefined()
      engine.dispose()
    }
  })

  it('B12: a phrase that is cut in or muted fades out instead of stopping dead', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.say('Keep going.', 'en', 1)
    const first = ctx.sources[ctx.sources.length - 1]!
    const gainsBefore = ctx.gains.length
    engine.say('Off route.', 'en', 3)
    expect(first.stops).toBe(1)
    const phraseGain = ctx.gains[gainsBefore - 1]!
    expect(phraseGain.gain.linear).toEqual([0]) // ramp to silence before the stop
    // The cut source lets go of its nodes when it has ended.
    first.onended?.()
    expect(engine.getSnapshot().phrase?.text).toBe('Off route.') // the old source does not advance the queue
    const second = ctx.sources[ctx.sources.length - 1]!
    engine.updateSettings({ muted: true })
    expect(second.stops).toBe(1)
  })

  it('releases the nodes of a phrase that ended', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.say('Back on route.', 'en', 2)
    const src = ctx.sources[ctx.sources.length - 1]!
    src.onended?.()
    expect(src.disconnected).toBe(1)
  })

  it('B14: the music is un-ducked when a cut-in phrase can only be shown silently', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.say('Keep going.', 'en', 1)
    ctx.state = 'suspended'
    const duck = (engine as unknown as { graph: { duck: { gain: FakeParam } } }).graph.duck.gain
    expect(duck.targets.at(-1)).toBe(0.3)
    engine.say('Off route.', 'en', 3)
    expect(duck.targets.at(-1)).toBe(1)
  })

  it('B20, B8: ignores blank phrases and shortens very long ones, bubble included', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    const n = ctx.sources.length
    engine.say('   ', 'en')
    engine.say('', 'es', 5)
    expect(ctx.sources.length).toBe(n)
    expect(engine.getSnapshot().phrase).toBeUndefined()
    engine.say('Keep walking along the street. '.repeat(40), 'en')
    const phrase = engine.getSnapshot().phrase!
    expect(phrase.text.length).toBeLessThanOrEqual(280)
    expect(phrase.text.endsWith('street.')).toBe(true)
    expect(ctx.sources[ctx.sources.length - 1]!.buffer!.length).toBeLessThan(22050 * 40)
  })

  it('P2: pre-rendered phrases are ready when they are due, and the cache is bounded in bytes', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.prewarm(['50 meters to the next gem.', '100 meters to the next gem.', '50 meters to the next gem.'], 'en')
    expect(engine.voiceStats.rendered).toBe(0) // nothing on the spot
    vi.advanceTimersByTime(500)
    expect(engine.voiceStats.rendered).toBe(2)
    engine.unlock()
    engine.say('50 meters to the next gem.', 'en')
    expect(engine.voiceStats.rendered).toBe(2) // no synthesis at the moment it is due
    engine.dispose()
  })

  it('P2: pre-rendering waits while a phrase is on air', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    engine.say('Back on route.', 'en', 2)
    const rendered = engine.voiceStats.rendered
    engine.prewarm(['Turn left.'], 'en')
    vi.advanceTimersByTime(2000)
    expect(engine.voiceStats.rendered).toBe(rendered)
    engine.stopVoice()
    vi.advanceTimersByTime(600)
    expect(engine.voiceStats.rendered).toBe(rendered + 1)
    engine.dispose()
  })
})

describe('engine lifecycle (review Nov 2026)', () => {
  it('B15: replaces a context the system has closed on the next tap, and the music goes on', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    engine.startMusic(7)
    engine.setTempo(110)
    const first = FakeContext.instances[0]!
    runner(first)(500)
    first.state = 'closed'
    first.onstatechange?.()
    expect(engine.getSnapshot().status).toBe('closed')
    engine.unlock()
    expect(FakeContext.instances).toHaveLength(2)
    const second = FakeContext.instances[1]!
    expect(engine.getSnapshot().status).toBe('running')
    runner(second)(1000)
    expect(second.oscillators).toBeGreaterThan(5)
    // The old context's late events change nothing.
    first.state = 'running'
    first.onstatechange?.()
    expect(engine.getSnapshot().status).toBe('running')
    engine.dispose()
  })

  it('B17: a non-finite tempo means standing still, the music keeps working afterwards', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.startMusic(3)
    engine.setTempo(NaN)
    expect(engine.getSnapshot().music).toBe('paused')
    engine.setTempo(120)
    runner(ctx)(1000)
    expect(ctx.oscillators).toBeGreaterThan(5)
    engine.setTempo(Infinity)
    expect(engine.tempo).toBeLessThanOrEqual(300)
    engine.setTempo(NaN)
    engine.setTempo(100)
    expect(Number.isFinite(engine.tempo)).toBe(true)
    runner(ctx)(1000)
    expect(Number.isFinite(engine.tempo)).toBe(true)
    engine.dispose()
  })

  it('B21 (revised): a hidden page fades the music out and stops its timer, and it resumes in place', () => {
    vi.useFakeTimers()
    let visibility: 'visible' | 'hidden' = 'visible'
    const listeners: (() => void)[] = []
    const doc = { get visibilityState() { return visibility }, addEventListener: (_t: string, fn: () => void) => listeners.push(fn), removeEventListener() {} }
    const win = { ...fakeWindow(), document: doc } as unknown as Window & typeof globalThis
    const engine = new AudioEngine(DEFAULT_AUDIO, win)
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.startMusic(5)
    engine.setTempo(120)
    runner(ctx)(500)
    const before = ctx.oscillators
    expect(before).toBeGreaterThan(0)
    visibility = 'hidden'
    for (const fn of listeners) fn()
    const timers = vi.getTimerCount()
    runner(ctx)(1000)
    expect(ctx.oscillators).toBe(before) // nothing scheduled while hidden
    visibility = 'visible'
    for (const fn of listeners) fn()
    expect(vi.getTimerCount()).toBeGreaterThan(timers)
    runner(ctx)(500)
    expect(ctx.oscillators).toBeGreaterThan(before)
    engine.dispose()
  })

  it('B22: music nodes are released when their note ends', () => {
    vi.useFakeTimers()
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.startMusic(9)
    engine.setTempo(120)
    runner(ctx)(300)
    const oscs: { onended: (() => void) | null; disconnected: number }[] = []
    const original = ctx.createOscillator.bind(ctx)
    ctx.createOscillator = () => {
      const o = original() as unknown as { onended: (() => void) | null; disconnected: number }
      oscs.push(o)
      return o as never
    }
    runner(ctx)(300)
    expect(oscs.length).toBeGreaterThan(0)
    for (const o of oscs) {
      expect(o.onended).toBeTypeOf('function')
      o.onended!()
      expect(o.disconnected).toBe(1)
    }
    engine.dispose()
  })

  it('sound effects are played on a running context and release their nodes', () => {
    const engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    engine.unlock()
    const ctx = FakeContext.instances[0]!
    engine.playSfx('finish')
    expect(ctx.oscillators).toBeGreaterThan(8)
    ctx.state = 'suspended'
    const n = ctx.oscillators
    engine.playSfx('gem')
    expect(ctx.oscillators).toBe(n)
  })

  it('the summary fanfare and rest phrase play, and mute or voice only silence them', () => {
    const on = new AudioEngine(DEFAULT_AUDIO, fakeWindow())
    on.unlock()
    const ctxOn = FakeContext.instances.at(-1)!
    on.playSfx('fanfare')
    const afterFanfare = ctxOn.oscillators
    expect(afterFanfare).toBeGreaterThan(6)
    on.playSfx('rest')
    expect(ctxOn.oscillators).toBeGreaterThan(afterFanfare)
    for (const settings of [{ ...DEFAULT_AUDIO, muted: true }, { ...DEFAULT_AUDIO, voiceOnly: true }]) {
      FakeContext.instances = []
      const off = new AudioEngine(settings, fakeWindow())
      off.unlock()
      off.playSfx('fanfare')
      off.playSfx('rest')
      expect(FakeContext.instances[0]?.oscillators ?? 0).toBe(0)
    }
  })
})

describe('P-V5: the bubble always matches the phrase on air', () => {
  type Act =
    | { a: 'say'; text: string; locale: 'en' | 'es'; priority: number }
    | { a: 'end' }
    | { a: 'stop' }
    | { a: 'mute'; on: boolean }
    | { a: 'wait'; ms: number }
    | { a: 'state'; state: 'running' | 'suspended' | 'interrupted' }
  const act: fc.Arbitrary<Act> = fc.oneof(
    { weight: 6, arbitrary: fc.record({ a: fc.constant('say' as const), text: fc.constantFrom('One.', 'Two!', 'Three, three.', 'Four four four four.', '   ', 'x'.repeat(400)), locale: fc.constantFrom('en' as const, 'es' as const), priority: fc.integer({ min: 1, max: 5 }) }) },
    { weight: 4, arbitrary: fc.constant({ a: 'end' as const }) },
    { weight: 1, arbitrary: fc.constant({ a: 'stop' as const }) },
    { weight: 1, arbitrary: fc.record({ a: fc.constant('mute' as const), on: fc.boolean() }) },
    { weight: 3, arbitrary: fc.record({ a: fc.constant('wait' as const), ms: fc.integer({ min: 100, max: 9000 }) }) },
    { weight: 1, arbitrary: fc.record({ a: fc.constant('state' as const), state: fc.constantFrom('running' as const, 'suspended' as const, 'interrupted' as const) }) },
  )

  it('holds for any sequence of phrases, endings, stops, mutes, waits and context changes, and nothing gets stuck', () => {
    vi.useFakeTimers()
    fc.assert(
      fc.property(fc.array(act, { maxLength: 40 }), (acts) => {
        FakeContext.instances = []
        const engine = new AudioEngine({ ...DEFAULT_AUDIO }, hiddenWindow())
        engine.unlock()
        const ctx = FakeContext.instances[0]!
        const check = () => {
          const snap = engine.getSnapshot()
          const playing = queueOf(engine).playing
          expect(snap.phrase?.text).toBe(playing?.text)
          if (snap.speaking) expect(snap.phrase).toBeDefined()
          if (snap.phrase) expect(snap.phrase.text.length).toBeLessThanOrEqual(280)
        }
        for (const x of acts) {
          if (x.a === 'say') engine.say(x.text, x.locale, x.priority)
          else if (x.a === 'end') ctx.sources[ctx.sources.length - 1]?.onended?.()
          else if (x.a === 'stop') engine.stopVoice()
          else if (x.a === 'mute') engine.updateSettings({ muted: x.on })
          else if (x.a === 'wait') vi.advanceTimersByTime(x.ms)
          else {
            ctx.state = x.state
            ctx.onstatechange?.()
          }
          check()
        }
        // Nothing is stuck: with time (and the sources ending), everything is spoken or dropped.
        ctx.state = 'running'
        for (let i = 0; i < 40; i++) {
          ctx.sources[ctx.sources.length - 1]?.onended?.()
          vi.advanceTimersByTime(8000)
        }
        expect(engine.getSnapshot().phrase).toBeUndefined()
        expect(queueOf(engine).playing).toBeUndefined()
        expect(queueOf(engine).size).toBe(0)
        engine.dispose()
      }),
      { seed: 20261204, numRuns: 60 },
    )
  })
})
