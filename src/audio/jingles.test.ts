import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JINGLE_DUCK_LEVEL, JINGLE_TAIL_S, jingleDuckOps, valueAt } from './automation.ts'
import { AudioEngine } from './engine.ts'
import { FakeContext, fakeWindow, type FakeGain } from './fakeAudio.ts'
import type { Graph } from './graph.ts'
import { themeReady } from './musicPlayer.ts'
import { DEFAULT_AUDIO } from './settings.ts'
import { FANFARE, FINISH, GEM, GEM_LAST, JINGLES, SCARE, SFX, sfxDuration, sfxPeak } from './sfx.ts'

describe('the jingles', () => {
  it('have the planned lengths', () => {
    expect(sfxDuration(GEM)).toBeGreaterThanOrEqual(0.2)
    expect(sfxDuration(GEM)).toBeLessThanOrEqual(0.5)
    expect(sfxDuration(GEM_LAST)).toBeGreaterThan(sfxDuration(GEM))
    expect(sfxDuration(SCARE)).toBeLessThan(0.8)
    expect(sfxDuration(FINISH)).toBeGreaterThanOrEqual(2)
    expect(sfxDuration(FINISH)).toBeLessThanOrEqual(3)
    expect(sfxDuration(FANFARE)).toBeLessThan(sfxDuration(FINISH))
  })

  it('stay under half of full scale, and the scare is softer than a gem', () => {
    for (const [name, notes] of Object.entries(SFX)) expect(sfxPeak(notes), name).toBeLessThanOrEqual(0.5)
    expect(sfxPeak(SCARE)).toBeLessThan(sfxPeak(GEM))
  })

  it('the scare has no noise burst', () => {
    expect(SCARE.some((n) => n.wave === 'noise')).toBe(false)
  })

  it('duck the loop: gem, last gem, scare, finish and the summary fanfare, not the click or the quiet cues', () => {
    expect([...JINGLES].sort()).toEqual(['fanfare', 'finish', 'gem', 'gemLast', 'scare'])
  })

  it('finish with a major chord on A over the whole-tone run (a few notes of the loop key family)', () => {
    const last = FINISH.filter((n) => n.at === 1.25 && n.wave !== 'noise' && n.wave !== 'triangle').map((n) => Math.round(n.hz))
    expect(last.sort()).toEqual([1109, 1319, 1760])
  })
})

describe('jingle ducking curve', () => {
  it('glides down at once, holds, and comes back after the jingle and its tail', () => {
    const ops = jingleDuckOps(10, 0.4)
    expect(valueAt(ops, 9.9, 1)).toBeCloseTo(1)
    expect(valueAt(ops, 10.3, 1)).toBeCloseTo(JINGLE_DUCK_LEVEL, 2)
    expect(valueAt(ops, 10.4, 1)).toBeCloseTo(JINGLE_DUCK_LEVEL, 2)
    const release = 10 + 0.4 + JINGLE_TAIL_S
    expect(valueAt(ops, release - 0.01, 1)).toBeLessThan(0.4)
    expect(valueAt(ops, release + 1.5, 1)).toBeGreaterThan(0.99)
    // No click: every value stays between the duck level and 1.
    for (let t = 9.9; t < 13; t += 0.01) {
      const v = valueAt(ops, t, 1)
      expect(v).toBeGreaterThanOrEqual(JINGLE_DUCK_LEVEL - 1e-6)
      expect(v).toBeLessThanOrEqual(1 + 1e-6)
    }
  })
})

describe('jingles in the engine', () => {
  let engine: AudioEngine
  let ctx: FakeContext
  let graph: Graph
  const gain = (name: 'jingleDuck' | 'duck' | 'gate'): FakeGain => graph[name] as unknown as FakeGain

  beforeAll(() => themeReady())
  beforeEach(() => {
    FakeContext.instances = []
    engine = new AudioEngine(DEFAULT_AUDIO, fakeWindow().win)
    engine.unlock()
    ctx = FakeContext.instances[0]!
    graph = (engine as unknown as { graph: Graph }).graph
  })
  afterEach(() => engine.dispose())

  it('a gem lowers the loop for its length and brings it back, on the audio clock', () => {
    ctx.currentTime = 5
    engine.playSfx('gem')
    const targets = gain('jingleDuck').gain.events.filter((e) => e.kind === 'target')
    expect(targets.map((e) => e.value)).toEqual([JINGLE_DUCK_LEVEL, 1])
    expect(targets[0]!.time).toBe(5)
    expect(targets[1]!.time).toBeCloseTo(5 + sfxDuration(GEM) + JINGLE_TAIL_S)
  })

  it('the finish ducks for its whole 2.65 s, and a second jingle extends the duck', () => {
    ctx.currentTime = 1
    engine.playSfx('finish')
    ctx.currentTime = 2
    engine.playSfx('scare')
    const releases = gain('jingleDuck').gain.events.filter((e) => e.kind === 'target' && e.value === 1).map((e) => e.time)
    expect(releases[0]).toBeCloseTo(1 + sfxDuration(FINISH) + JINGLE_TAIL_S)
    expect(releases[1]).toBeCloseTo(2 + sfxDuration(SCARE) + JINGLE_TAIL_S)
    // The newer duck holds the level from where it is (no jump) before it sets its own targets.
    const events = gain('jingleDuck').gain.events
    expect(events.some((e) => e.kind === 'cancel' && e.time === 2)).toBe(true)
  })

  it('a click is not a jingle: the loop is not touched', () => {
    engine.playSfx('click')
    engine.playSfx('offRoute')
    expect(gain('jingleDuck').gain.events).toHaveLength(0)
  })

  it('the voice duck and the jingle duck are separate nodes', () => {
    engine.say('Keep going.', 'en', 1)
    const voiceEvents = gain('duck').gain.events.length
    engine.playSfx('gem')
    expect(gain('duck').gain.events.length).toBe(voiceEvents) // the jingle does not touch the voice duck
    expect(gain('jingleDuck')).not.toBe(gain('duck'))
  })

  it('jingles obey mute and the effects volume, and the music setting does not matter', () => {
    engine.updateSettings({ chiptune: false })
    const before = ctx.oscillators.length
    engine.playSfx('gem')
    expect(ctx.oscillators.length).toBeGreaterThan(before) // still plays with the music off
    engine.updateSettings({ sfx: 0 })
    const n = ctx.oscillators.length
    engine.playSfx('gem')
    expect(ctx.oscillators.length).toBe(n)
    engine.updateSettings({ sfx: 0.7, muted: true })
    engine.playSfx('finish')
    expect(ctx.oscillators.length).toBe(n)
  })

  it('every jingle note starts and ends at zero gain (no clicks)', () => {
    engine.playSfx('finish')
    const envelopes = ctx.gains.filter((g) => g.gain.events.some((e) => e.kind === 'linear' && e.value === 0))
    expect(envelopes.length).toBeGreaterThanOrEqual(FINISH.length - 1)
    for (const g of envelopes) {
      expect(g.gain.events[0]).toMatchObject({ kind: 'set', value: 0 })
      expect(g.gain.events.at(-1)).toMatchObject({ kind: 'linear', value: 0 })
    }
  })

  it('the master goes through a limiter, so music, jingles and voice together do not clip', () => {
    const master = graph.master as unknown as FakeGain
    expect(master.connections).toHaveLength(1)
    expect(master.connections[0]).not.toBe(ctx.destination)
  })
})
