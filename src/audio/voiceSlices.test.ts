import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RENDER_SLICE_MS, VOICE_RATE, VoicePlayer } from './voicePlayer.ts'
import { RENDER_CHUNK, renderText, renderTextSliced } from './voice/synth.ts'

/** Phrase rendering in slices (voice-audio requirement 7e, far-pan budget): no single task of 60 to 90 ms on the main thread. */
const PHRASES = ['In 200 meters, turn left onto Calle de Colón.', 'Back on route.', '50 meters to the next gem.', 'Gira a la derecha en la calle Mayor.']

const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

describe('sliced synthesis', () => {
  it('gives the very samples of the one-piece render, whatever the chunk', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHRASES), fc.integer({ min: 1, max: 9_000 }), (text, chunk) => {
        const locale = /[áó]|derecha/.test(text) ? 'es' : 'en'
        const whole = renderText(text, locale, { sampleRate: VOICE_RATE })
        const run = renderTextSliced(text, locale, { sampleRate: VOICE_RATE }, chunk)
        let pauses = 0
        for (;;) {
          const s = run.next()
          if (s.done) {
            expect(same(s.value, whole)).toBe(true)
            break
          }
          pauses++
        }
        // It paused at least once every `chunk` samples, plus the two passes.
        expect(pauses).toBeGreaterThanOrEqual(Math.floor(whole.length / chunk) - 1)
      }),
      { numRuns: 12, seed: 7 },
    )
  })

  it('a phrase of a few seconds pauses many times at the default chunk', () => {
    const run = renderTextSliced(PHRASES[0]!, 'en', { sampleRate: VOICE_RATE })
    let pauses = 0
    while (!run.next().done) pauses++
    expect(pauses).toBeGreaterThan(8)
    expect(RENDER_CHUNK / VOICE_RATE).toBeLessThan(0.2)
  })
})

describe('pre-rendering in slices', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function player(clockStepMs: number) {
    let t = 0
    return new VoicePlayer({ graph: () => undefined, canSpeak: () => false, emit: () => undefined, now: () => (t += clockStepMs) })
  }

  it('a phrase is rendered over several timer slots when the work takes longer than a slice, and ends up as the same cache entry', () => {
    const p = player(RENDER_SLICE_MS / 2)
    p.prewarm([PHRASES[0]!], 'en')
    vi.advanceTimersByTime(10)
    expect(p.stats.slices).toBe(1)
    expect(p.stats.rendered).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(p.stats.rendered).toBe(1)
    expect(p.stats.slices).toBeGreaterThan(3)
    p.dispose()
  })

  it('with a fast clock the phrase is done in one slot (nothing is slower than before)', () => {
    const p = player(0)
    p.prewarm([PHRASES[0]!, PHRASES[1]!], 'en')
    vi.advanceTimersByTime(10)
    expect(p.stats.rendered).toBe(1)
    vi.advanceTimersByTime(40)
    expect(p.stats.rendered).toBe(2)
    p.dispose()
  })

  it('a list trimmed under a half-rendered phrase starts the next one afresh and loses nothing it still holds', () => {
    const p = player(RENDER_SLICE_MS)
    p.prewarm([PHRASES[0]!], 'en')
    vi.advanceTimersByTime(80)
    expect(p.stats.rendered).toBe(0)
    p.prewarm(Array.from({ length: 40 }, (_, k) => `${k + 1} meters to the next gem.`), 'en')
    vi.advanceTimersByTime(10 * 60_000)
    expect(p.stats.failures).toBe(0)
    expect(p.stats.rendered).toBe(32)
    p.dispose()
  })
})
