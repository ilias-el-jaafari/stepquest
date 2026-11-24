import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { COMPLETE_TITLES, PAUSED_TITLES, summarize, titleFor } from './summary.ts'

const num = fc.oneof(fc.double({ min: -1e5, max: 1e6, noNaN: true }), fc.constantFrom(Number.NaN, Infinity, -Infinity))
const stats = fc.record({ walkedM: num, steps: num, elapsedMs: num, paceMinPerKm: fc.option(num, { nil: undefined }), collected: num, total: num })
const kind = fc.constantFrom('complete' as const, 'paused' as const)

describe('P-6d: the summary is always sane', () => {
  it('gems are whole numbers within 0..total and every number is finite and not negative', () => {
    fc.assert(
      fc.property(stats, kind, (s, k) => {
        const r = summarize(s, k)
        expect(Number.isInteger(r.collected) && Number.isInteger(r.total)).toBe(true)
        expect(r.collected).toBeGreaterThanOrEqual(0)
        expect(r.collected).toBeLessThanOrEqual(r.total)
        for (const n of [r.walkedM, r.steps, r.elapsedMs]) expect(Number.isFinite(n) && n >= 0).toBe(true)
        if (r.paceMinPerKm !== undefined) expect(Number.isFinite(r.paceMinPerKm) && r.paceMinPerKm >= 0).toBe(true)
      }),
    )
  })
  it('pace is only given once 50 m are walked', () => {
    fc.assert(fc.property(stats, kind, (s, k) => {
        const r = summarize(s, k)
        expect(r.paceMinPerKm === undefined || r.walkedM >= 50).toBe(true)
      }))
  })
  it('the title comes from the right set and never goes down as steps grow (same pace)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40000 }), fc.integer({ min: 0, max: 40000 }), fc.option(fc.double({ min: 3, max: 20, noNaN: true }), { nil: undefined }), fc.integer({ min: 0, max: 20 }), (a, b, pace, gems) => {
        expect(PAUSED_TITLES).toContain(titleFor('paused', a, pace, gems))
        expect(COMPLETE_TITLES).toContain(titleFor('complete', a, pace, gems))
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        // A quick walk is its own title, so rank the others by steps only.
        const rank = (id: string) => ['scout', 'hero', 'wayfarer', 'legend'].indexOf(id)
        const x = titleFor('complete', lo, undefined, gems)
        const y = titleFor('complete', hi, undefined, gems)
        expect(rank(y)).toBeGreaterThanOrEqual(rank(x))
      }),
    )
  })
})
