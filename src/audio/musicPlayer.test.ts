import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { midiToHz } from './chiptune.ts'
import { FakeContext, type FakeParam } from './fakeAudio.ts'
import { createGraph } from './graph.ts'
import { MusicPlayer, resetThemeForTests, themeLoaded, themeReady } from './musicPlayer.ts'
import { DEFAULT_AUDIO, type AudioSettings } from './settings.ts'
import { STEPS_PER_LOOP, themeEventsAt } from './theme.ts'

const STEP_S = 60 / 120 / 4 // 120 BPM, one beat per step

let ctx: FakeContext
let settings: AudioSettings
let hidden: boolean
let player: MusicPlayer

function setup(patch: Partial<AudioSettings> = {}) {
  ctx = new FakeContext()
  ctx.state = 'running'
  settings = { ...DEFAULT_AUDIO, ...patch }
  hidden = false
  const graph = createGraph(ctx as unknown as AudioContext)
  player = new MusicPlayer({ graph: () => graph, settings: () => settings, hidden: () => hidden, emit: () => {} })
  return graph
}

/** Move the audio clock and the 25 ms timer together. */
const run = (ms: number) => {
  for (let i = 0; i < ms / 25; i++) {
    ctx.currentTime += 0.025
    vi.advanceTimersByTime(25)
  }
}

beforeAll(() => themeReady())
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  player.stop()
  vi.useRealTimers()
})

/** Frequencies of the tone and kick oscillators the theme asks for at a step. */
function expectedHz(seed: number, step: number): number[] {
  const ev = themeEventsAt(seed, step)
  const out: number[] = []
  if (ev.lead) out.push(midiToHz(ev.lead.midi))
  if (ev.arp) out.push(midiToHz(ev.arp.midi))
  if (ev.bass) out.push(midiToHz(ev.bass.midi))
  if (ev.drum === 'kick') out.push(160)
  return out.sort((a, b) => a - b)
}

describe('look-ahead scheduling', () => {
  it('schedules notes a little ahead of the audio clock, never further than the window', () => {
    setup()
    player.start(4)
    player.setTempo(120)
    let farthest = 0
    for (let i = 0; i < 80; i++) {
      run(25)
      const latest = Math.max(0, ...ctx.oscillators.map((o) => o.startedAt ?? 0))
      expect(latest - ctx.currentTime).toBeLessThanOrEqual(0.15 + 1e-9)
      farthest = Math.max(farthest, latest - ctx.currentTime)
    }
    expect(farthest).toBeGreaterThan(0.05) // really queued ahead of the clock
  })

  it('plays every step once, in order, and the loop turns over with no gap or repeat', () => {
    setup()
    player.start(4)
    player.setTempo(120)
    run((STEPS_PER_LOOP + 40) * STEP_S * 1000)
    const t0 = ctx.oscillators.map((o) => o.startedAt!).sort((a, b) => a - b)[0]!
    const byStep = new Map<number, number[]>()
    for (const o of ctx.oscillators) {
      const k = Math.round((o.startedAt! - t0) / STEP_S)
      expect(Math.abs(o.startedAt! - (t0 + k * STEP_S))).toBeLessThan(1e-6) // on the step grid
      byStep.set(k, [...(byStep.get(k) ?? []), o.frequency.value])
    }
    const steps = Math.max(...byStep.keys())
    expect(steps).toBeGreaterThan(STEPS_PER_LOOP + 20)
    for (let k = 0; k <= steps; k++) {
      expect((byStep.get(k) ?? []).sort((a, b) => a - b), `step ${k}`).toEqual(expectedHz(4, k).map((hz) => expect.closeTo(hz, 6)))
    }
    // Step 256 sounds exactly like step 0: the loop is seamless.
    expect(byStep.get(STEPS_PER_LOOP)).toEqual(byStep.get(0))
  })

  it('stops: no more notes and no timer', () => {
    setup()
    player.start(1)
    player.setTempo(120)
    run(500)
    expect(vi.getTimerCount()).toBe(1)
    player.stop()
    const n = ctx.oscillators.length
    expect(vi.getTimerCount()).toBe(0)
    run(1000)
    expect(ctx.oscillators.length).toBe(n)
    expect(player.state).toBe('off')
  })

  it('pauses when the walker stops and carries on at the same place when walking again', () => {
    setup()
    player.start(1)
    player.setTempo(120)
    run(1000)
    player.setTempo(undefined)
    run(2500)
    expect(player.state).toBe('paused')
    const n = ctx.oscillators.length
    run(1000)
    expect(ctx.oscillators.length).toBe(n)
    player.setTempo(120)
    run(600)
    expect(player.state).toBe('playing')
    expect(ctx.oscillators.length).toBeGreaterThan(n)
  })

  it('does not burst out missed steps after a stall, it jumps forward', () => {
    setup()
    player.start(1)
    player.setTempo(120)
    run(500)
    const n = ctx.oscillators.length
    ctx.currentTime += 30 // the tab slept for 30 s
    vi.advanceTimersByTime(25)
    expect(ctx.oscillators.length - n).toBeLessThan(40)
  })
})

describe('page visibility', () => {
  it('fades out and stops the timer while hidden, and resumes in place when visible', () => {
    const graph = setup()
    player.start(1)
    player.setTempo(120)
    run(500)
    const n = ctx.oscillators.length
    player.pageHidden()
    expect(vi.getTimerCount()).toBe(0)
    expect((graph.gate.gain as unknown as FakeParam).events.at(-1)).toMatchObject({ kind: 'target', value: 0 })
    run(2000)
    expect(ctx.oscillators.length).toBe(n)
    player.pageVisible()
    expect((graph.gate.gain as unknown as FakeParam).events.at(-1)).toMatchObject({ kind: 'target', value: 1 })
    run(100)
    const burst = ctx.oscillators.length - n
    expect(burst).toBeGreaterThan(0)
    expect(burst).toBeLessThan(12)
  })

  it('notices a hidden page by itself on a timer tick', () => {
    setup()
    player.start(1)
    player.setTempo(120)
    run(200)
    hidden = true
    run(50)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('when the music cannot be heard', () => {
  it.each([{ muted: true }, { chiptune: false }, { voiceOnly: true }, { music: 0 }])('%o: no timer, no notes, and the loop is not even loaded', async (patch) => {
    resetThemeForTests()
    setup(patch)
    player.playMenu()
    player.start(3)
    player.setTempo(120)
    run(2000)
    expect(vi.getTimerCount()).toBe(0)
    expect(ctx.oscillators).toHaveLength(0)
    expect(themeLoaded()).toBe(false)
    await themeReady() // the rest of the file finds it in memory
  })

  it('starts as soon as the music can be heard, and the loop loads on the first audible tick', async () => {
    resetThemeForTests()
    setup({ chiptune: false })
    player.start(3)
    player.setTempo(120)
    run(500)
    expect(themeLoaded()).toBe(false)
    settings = { ...settings, chiptune: true }
    player.refresh()
    expect(vi.getTimerCount()).toBe(1)
    run(50)
    await themeReady()
    expect(themeLoaded()).toBe(true)
    run(500)
    expect(ctx.oscillators.length).toBeGreaterThan(5)
  })

  it('switching the music off stops the timer at once, switching it on restarts it', () => {
    setup()
    player.start(3)
    player.setTempo(120)
    run(300)
    settings = { ...settings, chiptune: false }
    player.refresh()
    expect(vi.getTimerCount()).toBe(0)
    const n = ctx.oscillators.length
    run(1000)
    expect(ctx.oscillators.length).toBe(n)
    settings = { ...settings, chiptune: true }
    player.refresh()
    run(500)
    expect(ctx.oscillators.length).toBeGreaterThan(n)
  })
})
