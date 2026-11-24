import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { interpolate } from '../i18n/locale.ts'
import { kickEnvelope, noiseHitEnvelope, sfxEnvelope, toneEnvelope, valueAt } from './automation.ts'
import { scheduleWindow, stepSeconds } from './scheduler.ts'
import { wrapBubbleText } from './speechBubble.ts'
import { glideTempo, MAX_BPM, MIN_BPM, sanitizeBpm, tempoForSpeed } from './tempo.ts'
import { textToPhones } from './voice/g2p.ts'
import { PHONEMES } from './voice/phonemes.ts'
import { renderText } from './voice/synth.ts'
import { limitSpokenText, MAX_SPOKEN_CHARS, normalizeSpeech } from './voice/text.ts'
import { VoiceQueue, type QueuedPhrase } from './voiceQueue.ts'

const SEED = 20261204
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

describe('voice and audio properties (review Nov 2026)', () => {
  it('P-V3: any callout in English or Spanish synthesizes to finite samples in [-1, 1], zero at both ends', () => {
    const vars = fc.record({ m: fc.integer({ min: 0, max: 2_000_000 }), n: fc.integer({ min: 1, max: 99 }), total: fc.integer({ min: 1, max: 99 }), steps: fc.integer({ min: 0, max: 200_000 }), dir: fc.constantFrom(...DIRS) })
    for (const [locale, dict] of [['en', en], ['es', es]] as const) {
      const keys = Object.keys(dict).filter((k) => k.startsWith('voice.')) as (keyof typeof dict)[]
      fc.assert(
        fc.property(fc.constantFrom(...keys), vars, (key, v) => {
          const text = interpolate(dict[key], { ...v, dir: dict[`dir.${v.dir}` as keyof typeof dict] }, locale)
          const out = renderText(text, locale)
          expect(out.length, text).toBeGreaterThan(2000)
          expect(out[0]).toBe(0)
          expect(out[out.length - 1]).toBe(0)
          for (const x of out) if (!Number.isFinite(x) || Math.abs(x) > 1) throw new Error(`bad sample ${x} in "${text}"`)
        }),
        { seed: SEED, numRuns: 40 },
      )
    }
  })

  it('P-V4: the voice queue keeps its invariants under any sequence of pushes and ends', () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant('push' as const), text: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), locale: fc.constantFrom('en' as const, 'es' as const), priority: fc.integer({ min: 1, max: 5 }), dt: fc.integer({ min: 0, max: 5000 }) }),
      fc.record({ kind: fc.constant('next' as const), dt: fc.integer({ min: 0, max: 12_000 }) }),
    )
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        const q = new VoiceQueue(3, 8000)
        let now = 0
        for (const o of ops) {
          now += o.dt
          if (o.kind === 'push') {
            const p: QueuedPhrase = { text: o.text, locale: o.locale, priority: o.priority, at: now }
            const before = q.playing
            const result = q.push(p)
            if (result === 'interrupt') {
              expect(before).toBeDefined()
              expect(p.priority).toBeGreaterThanOrEqual(before!.priority + 2)
              expect(q.playing).toBe(p)
            }
            if (before && p.priority >= before.priority + 2 && !(before.text === p.text && before.locale === p.locale)) expect(result).toBe('interrupt')
            if (result === 'play') expect(before).toBeUndefined()
          } else {
            const waiting = [...q.waiting]
            const got = q.next(now)
            if (got) {
              expect(q.playing).toBe(got)
              expect(got.priority >= 5 || now - got.at <= 8000, 'stale phrase handed out').toBe(true)
              // Nothing fresher-and-better was skipped.
              for (const w of waiting) {
                if (w === got) break
                expect(w.priority >= 5 || now - w.at > 8000, 'a better phrase was skipped').toBe(true)
              }
            } else expect(q.playing).toBeUndefined()
          }
          // Invariants.
          expect(q.size).toBeLessThanOrEqual(q.maxQueue)
          const all = [...(q.playing ? [q.playing] : []), ...q.waiting]
          expect(new Set(all.map((p) => `${p.locale}|${p.text}`)).size).toBe(all.length)
          const w = q.waiting
          for (let i = 1; i < w.length; i++) expect(w[i - 1]!.priority > w[i]!.priority || (w[i - 1]!.priority === w[i]!.priority && w[i - 1]!.at <= w[i]!.at)).toBe(true)
        }
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-V6: every envelope starts and ends at zero and never goes negative', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 1, noNaN: true }), fc.double({ min: 0, max: 1000, noNaN: true }), fc.double({ min: 0.02, max: 6, noNaN: true }), (level, start, len) => {
        const end = start + len
        const sets: [ReturnType<typeof toneEnvelope>, number, number][] = [
          [toneEnvelope(level, start, end), start, end + 0.08],
          [kickEnvelope(start, level), start, start + 0.16],
          [noiseHitEnvelope(level, start, len / 10), start, start + len / 10 + 0.02],
          [sfxEnvelope(level, start, end), start, end + 0.02],
        ]
        for (const [ops, from, stop] of sets) {
          expect(valueAt(ops, from)).toBe(0)
          expect(valueAt(ops, stop)).toBeLessThan(1e-3)
          for (let k = 0; k <= 40; k++) {
            const v = valueAt(ops, from + ((stop - from) * k) / 40)
            expect(v).toBeGreaterThanOrEqual(-1e-9)
            expect(v).toBeLessThanOrEqual(level * 1.0001)
          }
        }
      }),
      { seed: SEED, numRuns: 150 },
    )
  })

  it('P-V7: whatever number arrives (NaN, infinities, huge, negative), tempo, glide and schedule stay finite and in order', () => {
    const num = fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, 1e308, -1e308))
    fc.assert(
      fc.property(num, num, num, num, (a, b, dt, speed) => {
        const t = tempoForSpeed(speed, 0.75)
        if (t !== undefined) expect(t >= MIN_BPM && t <= MAX_BPM).toBe(true)
        const g = glideTempo(a, b, dt)
        expect(Number.isFinite(g) && g >= 1 && g <= 300).toBe(true)
        const s = sanitizeBpm(a)
        if (s !== undefined) expect(s >= 1 && s <= 300).toBe(true)
        expect(stepSeconds(a)).toBeGreaterThan(0)
        expect(Number.isFinite(stepSeconds(a))).toBe(true)
        const { steps, state } = scheduleWindow({ nextTime: Number.isFinite(b) ? b : 0, step: 0 }, Number.isFinite(dt) ? Math.abs(dt) % 1000 : 0, 0.5, a)
        let last = -Infinity
        for (const st of steps) {
          expect(Number.isFinite(st.time) && st.duration > 0).toBe(true)
          expect(st.time).toBeGreaterThanOrEqual(last)
          last = st.time
        }
        expect(Number.isFinite(state.nextTime)).toBe(true)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-V8: any text becomes known phonemes without digits or stacked pauses, and long text is limited', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 120 }), fc.constantFrom('en' as const, 'es' as const), (raw, locale) => {
        const text = normalizeSpeech(raw, locale)
        expect(/[0-9]/.test(text)).toBe(false)
        const phones = textToPhones(text, locale)
        let prevPause = false
        for (const p of phones) {
          expect(PHONEMES[p.p]).toBeDefined()
          const pause = PHONEMES[p.p].kind === 'pause' && p.p !== '_'
          expect(pause && prevPause).toBe(false)
          prevPause = pause
        }
        expect(phones.length === 0 || PHONEMES[phones[phones.length - 1]!.p].kind !== 'pause').toBe(true)
        expect([...limitSpokenText(raw)].length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-V8b: arbitrary digits, accents and punctuation never make the synthesizer throw or produce a bad sample', () => {
    const unit = fc.constantFrom(...'0123456789 .,;:!?¡¿ñÑüÜáéíóúçàö-km%mhs\u0303\u00a0abcdefghilnorstuvz'.split(''))
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 60 }), fc.constantFrom('en' as const, 'es' as const), (text, locale) => {
        const out = renderText(text, locale)
        for (const x of out) if (!Number.isFinite(x) || Math.abs(x) > 1) throw new Error(`bad sample ${x} for "${text}"`)
      }),
      { seed: SEED, numRuns: 60 },
    )
  })

  it('P-V2 (extended): wrapping terminates for any width and keeps every character in order', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme-ascii', maxLength: 80 }), fc.oneof(fc.integer({ min: -5, max: 40 }), fc.constantFrom(NaN, Infinity, -Infinity)), (text, width) => {
        const lines = wrapBubbleText(text, width)
        const w = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1
        for (const line of lines) {
          expect(line.length).toBeGreaterThan(0)
          expect(Array.from(line).length).toBeLessThanOrEqual(w)
        }
        expect(lines.join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
      }),
      { seed: SEED, numRuns: 300 },
    )
  })
})
