import { useCallback, useEffect, useRef, useState } from 'react'
import { FANFARE, PICKUP, play, unlockAudio } from '../audio/beep.ts'
import { APP_SLUG } from '../config/brand.ts'
import type { LatLon } from '../geo/geo.ts'
import { browserSource, type LocationErrorCode, type LocationSource } from '../quest/geolocation.ts'
import { applyFix, trackFor, type QuestState } from '../quest/quest.ts'
import { simulatedSource } from '../quest/simSource.ts'
import { clearQuest, saveQuest } from '../quest/storage.ts'
import type { GpsFix } from '../quest/types.ts'
import { keepScreenOn, type WakeLockHandle } from '../quest/wakeLock.ts'

const MUTE_KEY = `${APP_SLUG}.muted`
const SAVE_EVERY_MS = 1000

export type Pickup = { n: number; point: LatLon; index: number; total: number }

function sourceFor(q: QuestState): LocationSource {
  if (!q.simulated) return browserSource()
  return simulatedSource(trackFor(q.route), {
    timeScale: q.sim?.timeScale ?? 1,
    noiseM: q.sim?.noiseM ?? 0,
    glitches: (q.sim?.noiseM ?? 0) > 0,
    seed: q.startedAt % 1000,
    startAlongM: q.alongM,
    startTime: q.lastFixAt !== undefined ? q.lastFixAt + 2000 : q.startedAt,
  })
}

/** Drives an active quest: location source, events, sounds, wake lock and persistence. */
export function useQuestRunner() {
  const [quest, setQuest] = useState<QuestState>()
  const [pickup, setPickup] = useState<Pickup>()
  const [error, setError] = useState<LocationErrorCode>()
  const [wakeActive, setWakeActive] = useState(false)
  const [muted, setMutedState] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })
  const questRef = useRef<QuestState | undefined>(undefined)
  const stopRef = useRef<(() => void) | undefined>(undefined)
  const wakeRef = useRef<WakeLockHandle | undefined>(undefined)
  const lastSaveRef = useRef(0)
  const mutedRef = useRef(muted)
  const pickupCount = useRef(0)

  const stopTracking = useCallback(() => {
    stopRef.current?.()
    stopRef.current = undefined
    wakeRef.current?.release()
    wakeRef.current = undefined
    setWakeActive(false)
  }, [])

  const onFix = useCallback(
    (fix: GpsFix) => {
      const current = questRef.current
      // A finished quest ignores late fixes (the watch is stopped, but one may already be queued).
      if (!current || current.finishedAt !== undefined) return
      const { state, events } = applyFix(current, fix)
      questRef.current = state
      setError(undefined)
      let important = false
      for (const e of events) {
        if (e.type === 'collected') {
          important = true
          pickupCount.current++
          setPickup({ n: pickupCount.current, point: e.point, index: e.index, total: state.route.checkpoints.length })
          if (!mutedRef.current && !e.isFinish) play(PICKUP)
        }
        if (e.type === 'finished') {
          important = true
          if (!mutedRef.current) play(FANFARE)
          // Stop watchPosition (and the wake lock) as soon as the quest is complete.
          stopTracking()
          setError(undefined)
        }
      }
      setQuest(state)
      const now = Date.now()
      if (important || now - lastSaveRef.current > SAVE_EVERY_MS) {
        lastSaveRef.current = now
        saveQuest(state)
      }
    },
    [stopTracking],
  )

  const startTracking = useCallback(
    (q: QuestState) => {
      stopTracking()
      if (q.finishedAt !== undefined) return
      stopRef.current = sourceFor(q).start(onFix, (code) => {
        if (questRef.current?.finishedAt === undefined) setError(code)
      })
      wakeRef.current = keepScreenOn()
      // The lock resolves asynchronously; reflect it shortly after.
      setTimeout(() => setWakeActive(!!wakeRef.current?.active()), 500)
    },
    [onFix, stopTracking],
  )

  /** Start a new quest (call from a click so audio and wake lock are allowed). */
  const begin = useCallback(
    (q: QuestState) => {
      unlockAudio()
      questRef.current = q
      setQuest(q)
      setPickup(undefined)
      setError(undefined)
      saveQuest(q)
      startTracking(q)
    },
    [startTracking],
  )

  /** Switch a running quest to the simulator (e.g. after permission was denied). */
  const switchToSimulation = useCallback(
    (timeScale = 20) => {
      const q = questRef.current
      if (!q) return
      unlockAudio()
      const next: QuestState = { ...q, simulated: true, sim: { timeScale, noiseM: 0 }, startedAt: q.lastFixAt === undefined ? Date.now() : q.startedAt }
      questRef.current = next
      setQuest(next)
      saveQuest(next)
      startTracking(next)
    },
    [startTracking],
  )

  const end = useCallback(() => {
    stopTracking()
    clearQuest()
    questRef.current = undefined
    setQuest(undefined)
    setPickup(undefined)
    setError(undefined)
  }, [stopTracking])

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value
    setMutedState(value)
    if (!value) unlockAudio()
    try {
      localStorage.setItem(MUTE_KEY, value ? '1' : '0')
    } catch {
      // ignore
    }
  }, [])

  // Save when the page is hidden or closed, and stop everything on unmount.
  useEffect(() => {
    const save = () => {
      if (questRef.current) saveQuest(questRef.current)
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
      stopRef.current?.()
      wakeRef.current?.release()
    }
  }, [])

  return { quest, pickup, error, wakeActive, muted, setMuted, begin, end, switchToSimulation }
}
