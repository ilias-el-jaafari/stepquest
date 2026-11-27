import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './engine.ts'
import { FakeContext, fakeWindow } from './fakeAudio.ts'
import { resetThemeForTests, themeLoaded, themeReady } from './musicPlayer.ts'
import { AUDIO_STORAGE_KEY, DEFAULT_AUDIO, loadAudioSettings, musicAudible } from './settings.ts'
import { MUSIC_BUS_MAX } from './chiptune.ts'
import type { Graph } from './graph.ts'

let page: ReturnType<typeof fakeWindow>
const make = (patch: Partial<typeof DEFAULT_AUDIO> = {}) => new AudioEngine({ ...DEFAULT_AUDIO, ...patch }, page.win)
const ctx = () => FakeContext.instances[0]!
const run = (c: FakeContext, ms: number) => {
  for (let i = 0; i < ms / 25; i++) {
    c.currentTime += 0.025
    vi.advanceTimersByTime(25)
  }
}

beforeAll(() => themeReady())
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  FakeContext.instances = []
  page = fakeWindow()
})
afterEach(() => vi.useRealTimers())

describe('muted means nothing runs', () => {
  it('creates no AudioContext, loads no loop and runs no timer, however much is asked of it', async () => {
    resetThemeForTests()
    const engine = make({ muted: true })
    engine.armUnlock()
    page.fire('pointerup') // a tap while muted
    engine.unlock()
    engine.playMenuMusic()
    engine.startMusic(2)
    engine.setTempo(120)
    engine.playSfx('gem')
    vi.advanceTimersByTime(5000)
    expect(FakeContext.instances).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(themeLoaded()).toBe(false)
    await themeReady()
  })

  it('the tap that unmutes creates the context and the waiting music starts', () => {
    const engine = make({ muted: true })
    engine.playMenuMusic()
    engine.updateSettings({ muted: false })
    expect(FakeContext.instances).toHaveLength(1)
    expect(ctx().state).toBe('running')
    run(ctx(), 3000)
    expect(ctx().oscillators.length).toBeGreaterThan(5)
    engine.dispose()
  })

  it('muting while it plays silences the buses, stops the timer and suspends the context', () => {
    const engine = make()
    engine.unlock()
    engine.startMusic(1)
    engine.setTempo(120)
    run(ctx(), 500)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const graph = (engine as unknown as { graph: Graph }).graph
    engine.updateSettings({ muted: true })
    expect(graph.master.gain.value).toBe(0)
    expect(graph.music.gain.value).toBe(0)
    expect(ctx().suspended).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    const n = ctx().oscillators.length
    run(ctx(), 1000)
    expect(ctx().oscillators.length).toBe(n)
    // Taps and the page coming back do not wake it while muted.
    const resumed = ctx().resumed
    page.fire('pointerup')
    page.setVisibility('visible')
    expect(ctx().resumed).toBe(resumed)
    // Unmute: it wakes in that tap and the music picks up.
    engine.updateSettings({ muted: false })
    expect(ctx().resumed).toBe(resumed + 1)
    run(ctx(), 500)
    expect(ctx().oscillators.length).toBeGreaterThan(n)
    engine.dispose()
  })

  it('creates the AudioContext only in a gesture, even with music asked for', () => {
    const engine = make()
    engine.armUnlock()
    engine.playMenuMusic()
    vi.advanceTimersByTime(3000)
    expect(FakeContext.instances).toHaveLength(0)
    page.fire('pointerup')
    expect(FakeContext.instances).toHaveLength(1)
    engine.dispose()
  })
})

describe('the Chiptune music setting', () => {
  it('is on by default, but only audible while sound is on', () => {
    expect(DEFAULT_AUDIO.chiptune).toBe(true)
    expect(musicAudible(DEFAULT_AUDIO)).toBe(true)
    expect(musicAudible({ ...DEFAULT_AUDIO, muted: true })).toBe(false)
    expect(musicAudible({ ...DEFAULT_AUDIO, voiceOnly: true })).toBe(false)
    expect(musicAudible({ ...DEFAULT_AUDIO, chiptune: false })).toBe(false)
    expect(musicAudible({ ...DEFAULT_AUDIO, music: 0 })).toBe(false)
  })

  it('turning it off stops the music at once, turning it on starts it in the same tap', () => {
    const engine = make()
    engine.unlock()
    engine.startMusic(1)
    engine.setTempo(120)
    run(ctx(), 500)
    const graph = (engine as unknown as { graph: Graph }).graph
    engine.updateSettings({ chiptune: false })
    expect(graph.music.gain.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    const n = ctx().oscillators.length
    run(ctx(), 1000)
    expect(ctx().oscillators.length).toBe(n)
    expect(ctx().state).toBe('running') // jingles and the voice still have a context
    engine.updateSettings({ chiptune: true })
    expect(graph.music.gain.value).toBeGreaterThan(0)
    run(ctx(), 500)
    expect(ctx().oscillators.length).toBeGreaterThan(n)
    engine.dispose()
  })

  it('is saved on the device and read back', () => {
    const engine = make()
    engine.updateSettings({ chiptune: false })
    expect(JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY)!).chiptune).toBe(false)
    expect(loadAudioSettings().chiptune).toBe(false)
    expect(new AudioEngine(undefined, page.win).getSettings().chiptune).toBe(false)
  })

  it('keeps the music bus small: at full sliders it is the budgeted maximum', () => {
    const engine = make({ master: 1, music: 1 })
    engine.unlock()
    const graph = (engine as unknown as { graph: Graph }).graph
    expect(graph.music.gain.value).toBeCloseTo(MUSIC_BUS_MAX)
    expect(graph.music.gain.value).toBeLessThanOrEqual(0.35)
  })
})
