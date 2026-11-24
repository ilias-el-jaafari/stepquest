import { describe, expect, it } from 'vitest'
import type { QuestStats } from './stats.ts'
import { COMPLETE_TITLES, PAUSED_TITLES, summarize, titleFor } from './summary.ts'

const stats = (over: Partial<QuestStats> = {}): QuestStats => ({ walkedM: 7560, steps: 10080, elapsedMs: 95 * 60_000, paceMinPerKm: 12.5, collected: 10, total: 10, ...over })

describe('summarize', () => {
  it('carries the quest stats over', () => {
    expect(summarize(stats(), 'complete')).toEqual({ kind: 'complete', walkedM: 7560, steps: 10080, elapsedMs: 95 * 60_000, paceMinPerKm: 12.5, collected: 10, total: 10, title: 'wayfarer' })
  })
  it('clamps gems and replaces bad numbers by 0', () => {
    const s = summarize(stats({ collected: 14, total: 10, steps: Number.NaN, walkedM: -3, elapsedMs: Infinity }), 'paused')
    expect(s).toMatchObject({ collected: 10, steps: 0, walkedM: 0, elapsedMs: 0, paceMinPerKm: undefined })
  })
  it('has no pace before 50 m', () => {
    expect(summarize(stats({ walkedM: 30, paceMinPerKm: 9 }), 'paused').paceMinPerKm).toBeUndefined()
  })
})

describe('titleFor', () => {
  it.each([
    [1000, undefined, 'scout'],
    [5000, 12, 'hero'],
    [3200, 7, 'swift'],
    [3200, 9, 'scout'],
    [10000, 7, 'wayfarer'],
    [25000, 6, 'legend'],
  ])('completed with %i steps at pace %s is %s', (steps, pace, title) => {
    expect(titleFor('complete', steps, pace, 5)).toBe(title)
  })
  it('names a paused quest by its gems', () => {
    expect(titleFor('paused', 4000, 7, 0)).toBe('fresh')
    expect(titleFor('paused', 40, undefined, 3)).toBe('seeker')
  })
  it('keeps the two title sets apart', () => {
    expect(PAUSED_TITLES.some((t) => COMPLETE_TITLES.includes(t))).toBe(false)
  })
})
