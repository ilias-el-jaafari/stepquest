import { useCallback, useEffect, useState } from 'react'
import { dayKey, stepsToday } from '../quest/dailySteps.ts'

type Snapshot = { now: number; steps: number }

const snapshot = (): Snapshot => {
  const now = Date.now()
  return { now, steps: stepsToday(now) }
}

/** Milliseconds from `now` to the next local midnight (plus a second, so the new day has begun). */
export function msToMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 1, 0)
  return d.getTime() - now
}

/**
 * "Today" for the header, the Hero tab and the sunrise times. It is read again when the app
 * comes back to the foreground, when another tab writes the total, and at midnight, so an
 * app left open overnight or in the background does not show yesterday's numbers.
 */
export function useToday() {
  const [today, setToday] = useState(snapshot)
  const refresh = useCallback(() => {
    setToday((prev) => {
      const next = snapshot()
      return prev.steps === next.steps && dayKey(prev.now) === dayKey(next.now) ? prev : next
    })
  }, [])

  useEffect(() => {
    const onShow = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('focus', onShow)
    window.addEventListener('storage', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('focus', onShow)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh])

  const day = dayKey(today.now)
  useEffect(() => {
    const id = setTimeout(refresh, msToMidnight(Date.now()))
    return () => clearTimeout(id)
  }, [day, refresh])

  return { now: today.now, steps: today.steps, refresh }
}
