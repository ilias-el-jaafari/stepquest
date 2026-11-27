import { describe, expect, it } from 'vitest'
import { calmEvents, LEVELS, MUSIC_BUS_MAX, MUSIC_PEAK_CEILING, STEPS_PER_BAR, type StepEvents } from './chiptune.ts'
import { BARS, keyFor, STEPS_PER_LOOP, THEME_KEYS, themeEventsAt, themeLoop } from './theme.ts'

const loop = (seed = 0) => themeLoop(seed)
const bar = (seed: number, b: number) => loop(seed).slice(b * STEPS_PER_BAR, (b + 1) * STEPS_PER_BAR)
/** Semitones above the key's tonic (A), 0 to 11. */
const rel = (midi: number, seed: number) => (((midi - keyFor(seed) - 9) % 12) + 12) % 12
const notes = (ev: StepEvents) => [ev.lead, ev.arp, ev.bass].filter((n) => n !== undefined)

describe('the composed loop', () => {
  it('is sixteen bars of sixteen steps', () => {
    expect(BARS).toBe(16)
    expect(STEPS_PER_LOOP).toBe(256)
    expect(loop()).toHaveLength(256)
  })

  it('keeps the minor bars out of C♯ and B♭, and the whole-tone bars on their scale', () => {
    for (const seed of [0, 1, 2]) {
      for (let b = 0; b < BARS; b++) {
        const wander = b >= 8 && b <= 11
        const tonic = b >= 10 && b <= 11 ? 1 : 0 // A, then B-flat
        for (const ev of bar(seed, b)) {
          for (const n of notes(ev)) {
            const r = rel(n.midi, seed)
            if (wander) expect((r - tonic + 12) % 2, `bar ${b + 1} seed ${seed} midi ${n.midi}`).toBe(0)
            else expect([1, 4], `bar ${b + 1} seed ${seed} midi ${n.midi}`).not.toContain(r)
          }
        }
      }
    }
  })

  it('stays inside a playable range in every key, and no note runs into the next bar', () => {
    for (const seed of [0, 1, 2]) {
      loop(seed).forEach((ev, i) => {
        for (const n of notes(ev)) {
          expect(n.midi).toBeGreaterThanOrEqual(28)
          expect(n.midi).toBeLessThanOrEqual(96)
          expect(n.steps).toBeGreaterThanOrEqual(1)
          expect((i % STEPS_PER_BAR) + n.steps).toBeLessThanOrEqual(STEPS_PER_BAR)
        }
      })
    }
  })

  it('has a kick and a bass note on every bar line and no snare in the whole-tone bars', () => {
    for (let b = 0; b < BARS; b++) {
      const steps = bar(0, b)
      expect(steps[0]!.drum).toBe('kick')
      expect(steps[0]!.bass).toBeDefined()
      const snares = steps.filter((s) => s.drum === 'snare').length
      if (b >= 8 && b <= 11) expect(snares).toBe(0)
      else expect(snares).toBeGreaterThanOrEqual(2)
    }
  })

  it('moves the same tune to three minor keys picked by the seed', () => {
    expect(THEME_KEYS).toEqual([0, -2, 3])
    expect([0, 1, 2, 3, 4, 5].map(keyFor)).toEqual([0, -2, 3, 0, -2, 3])
    expect(keyFor(-1)).toBe(3)
    expect(keyFor(7.9)).toBe(-2)
    const a = loop(0)
    const g = loop(1)
    a.forEach((ev, i) => {
      expect(g[i]!.lead?.midi).toBe(ev.lead ? ev.lead.midi - 2 : undefined)
      expect(g[i]!.drum).toBe(ev.drum)
    })
  })

  it('repeats without a seam: step 256 is step 0, and so on for any seed', () => {
    for (const seed of [0, 1, 2, 99]) {
      for (let i = 0; i < STEPS_PER_LOOP; i++) {
        expect(themeEventsAt(seed, i + STEPS_PER_LOOP)).toBe(themeEventsAt(seed, i))
        expect(themeEventsAt(seed, i + 3 * STEPS_PER_LOOP)).toBe(themeEventsAt(seed, i))
      }
      expect(themeEventsAt(seed, -1)).toBe(themeEventsAt(seed, STEPS_PER_LOOP - 1))
    }
  })

  it('keeps the bass and the kick going through the breath at the end of the last bar', () => {
    const last = bar(0, 15)
    expect(last[12]!.bass).toBeDefined()
    expect(last[15]!.drum).toBe('snare') // a tiny page turn into bar 1
    const melodyEnd = Math.max(...last.map((s, i) => (s.lead ? i + s.lead.steps : 0)))
    expect(melodyEnd).toBeLessThan(STEPS_PER_BAR) // the lead breathes before the loop restarts
  })

  it('has a calm arrangement of lead, bass and soft kick', () => {
    let kicks = 0
    for (const ev of loop()) {
      const calm = calmEvents(ev)
      expect(calm.arp).toBeUndefined()
      expect(calm.drum === undefined || calm.drum === 'kick').toBe(true)
      if (calm.drum) kicks++
    }
    expect(kicks).toBe(32)
  })

  it('is quiet: the loudest step at full sliders stays under the ceiling', () => {
    const level = (ev: StepEvents) => (ev.lead ? LEVELS.lead : 0) + (ev.arp ? LEVELS.arp : 0) + (ev.bass ? LEVELS.bass : 0) + (ev.drum ? LEVELS[ev.drum] : 0)
    // A note that started earlier may still sound: sum everything that overlaps each step.
    for (const seed of [0, 1, 2]) {
      const l = loop(seed)
      let worst = 0
      l.forEach((_, i) => {
        let sum = 0
        for (let back = 0; back <= i && back < STEPS_PER_BAR; back++) {
          const ev = l[i - back]!
          for (const [voice, note] of [['lead', ev.lead], ['arp', ev.arp], ['bass', ev.bass]] as const) if (note && note.steps > back) sum += LEVELS[voice]
        }
        const here = l[i]!.drum
        // A kick lasts about a step and a half at a walking tempo; count the previous one too.
        if (here || l[i - 1]?.drum === 'kick') sum += LEVELS[here ?? 'kick']
        worst = Math.max(worst, sum)
      })
      expect(worst * MUSIC_BUS_MAX).toBeLessThanOrEqual(MUSIC_PEAK_CEILING)
      expect(Math.max(...l.map(level)) * MUSIC_BUS_MAX).toBeLessThanOrEqual(MUSIC_PEAK_CEILING)
    }
  })
})
