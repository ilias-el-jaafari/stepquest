import { beforeEach, describe, expect, it } from 'vitest'
import { addStepsToday, DAILY_STEPS_KEY, dayKey, stepsToday } from './dailySteps.ts'

const NOON = new Date(2026, 10, 22, 12).getTime()
const NEXT_DAY = new Date(2026, 10, 23, 0, 0, 5).getTime()

describe('steps today', () => {
  beforeEach(() => localStorage.clear())
  it('uses the local calendar day', () => {
    expect(dayKey(NOON)).toBe('2026-11-22')
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })
  it('starts at zero and adds up walks', () => {
    expect(stepsToday(NOON)).toBe(0)
    expect(addStepsToday(1200.4, NOON)).toBe(1200)
    expect(addStepsToday(800, NOON + 60_000)).toBe(2000)
    expect(stepsToday(NOON + 3_600_000)).toBe(2000)
  })
  it('starts again at midnight', () => {
    addStepsToday(5000, NOON)
    expect(stepsToday(NEXT_DAY)).toBe(0)
    expect(addStepsToday(10, NEXT_DAY)).toBe(10)
  })
  it('ignores garbage and negative or invalid steps', () => {
    localStorage.setItem(DAILY_STEPS_KEY, '{bad')
    expect(stepsToday(NOON)).toBe(0)
    localStorage.setItem(DAILY_STEPS_KEY, JSON.stringify({ day: 3, steps: 'x' }))
    expect(stepsToday(NOON)).toBe(0)
    expect(addStepsToday(-50, NOON)).toBe(0)
    expect(addStepsToday(Number.NaN, NOON)).toBe(0)
  })
})
