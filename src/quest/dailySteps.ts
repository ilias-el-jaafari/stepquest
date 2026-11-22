import { APP_SLUG } from '../config/brand.ts'

/** Steps walked in real (not simulated) quests today, kept on the device. */
export const DAILY_STEPS_KEY = `${APP_SLUG}.dailySteps`

type Daily = { day: string; steps: number }

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function read(): Daily | undefined {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DAILY_STEPS_KEY) ?? 'null')
    if (raw && typeof raw === 'object' && typeof (raw as Daily).day === 'string' && Number.isFinite((raw as Daily).steps)) return raw as Daily
  } catch {
    // Unreadable: start again.
  }
  return undefined
}

/** Steps recorded for the day of `now` (0 on a new day). */
export function stepsToday(now: number): number {
  const d = read()
  return d && d.day === dayKey(now) ? Math.max(0, Math.round(d.steps)) : 0
}

/** Add walked steps to today's total; returns the new total. */
export function addStepsToday(steps: number, now: number): number {
  const total = stepsToday(now) + Math.max(0, Math.round(Number.isFinite(steps) ? steps : 0))
  try {
    localStorage.setItem(DAILY_STEPS_KEY, JSON.stringify({ day: dayKey(now), steps: total }))
  } catch {
    // Storage blocked: the total lasts for this visit only.
  }
  return total
}
