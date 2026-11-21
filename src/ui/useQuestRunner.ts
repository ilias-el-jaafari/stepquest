import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CalloutPlanner, calloutText, sfxFor, type Callout } from '../audio/callouts.ts'
import { audioEngine } from '../audio/engine.ts'
import { isStale, PaceTracker, tempoForSpeed } from '../audio/tempo.ts'
import { useI18n } from '../i18n/index.ts'
import type { LatLon } from '../geo/geo.ts'
import { browserSource, type LocationErrorCode, type LocationSource } from '../quest/geolocation.ts'
import { applyFix, trackFor, type QuestState } from '../quest/quest.ts'
import { simulatedSource } from '../quest/simSource.ts'
import { clearQuest, saveQuest } from '../quest/storage.ts'
import type { GpsFix } from '../quest/types.ts'
import { keepScreenOn, type WakeLockHandle } from '../quest/wakeLock.ts'

const SAVE_EVERY_MS = 1000
/** How often the music checks that fixes still arrive (to pause when they stop). */
const PACE_CHECK_MS = 2000

/** A stable music seed per quest, so a resumed quest keeps its tune. */
function seedFor(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 100_000
}

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
  const { t, locale } = useI18n()
  const speakRef = useRef<(c: Callout) => void>(() => {})
  // Keep the speaker on the current language (callbacks below read it from the ref).
  useLayoutEffect(() => {
    speakRef.current = (c: Callout) => audioEngine().say(calloutText(c, t), locale, c.priority)
  })
  const questRef = useRef<QuestState | undefined>(undefined)
  const stopRef = useRef<(() => void) | undefined>(undefined)
  const wakeRef = useRef<WakeLockHandle | undefined>(undefined)
  const lastSaveRef = useRef(0)
  const pickupCount = useRef(0)
  const plannerRef = useRef<CalloutPlanner | undefined>(undefined)
  const paceRef = useRef(new PaceTracker())
  const lastFixWallRef = useRef<number | undefined>(undefined)

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
      const audio = audioEngine()
      // Sound: effects, spoken callouts and the music tempo from the walking pace.
      for (const name of sfxFor(events, state)) audio.playSfx(name)
      for (const c of plannerRef.current?.update(current, state, events) ?? []) speakRef.current(c)
      lastFixWallRef.current = Date.now()
      paceRef.current.push(state.odometer.totalM, fix.timestamp)
      if (state.finishedAt === undefined) audio.setTempo(tempoForSpeed(paceRef.current.speed(), state.strideM))
      let important = false
      for (const e of events) {
        if (e.type === 'collected') {
          important = true
          pickupCount.current++
          setPickup({ n: pickupCount.current, point: e.point, index: e.index, total: state.route.checkpoints.length })
        }
        if (e.type === 'finished') {
          important = true
          audio.stopMusic()
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
    (q: QuestState, resumed = false) => {
      const audio = audioEngine()
      // A fresh start runs inside the "Start quest" click, which unlocks audio (iOS).
      // After a reload there is no gesture yet: sound starts on the first tap.
      if (resumed) audio.armUnlock()
      else audio.unlock()
      audio.stopVoice()
      paceRef.current.reset()
      lastFixWallRef.current = undefined
      const planner = new CalloutPlanner(q)
      plannerRef.current = planner
      if (q.finishedAt === undefined) {
        audio.startMusic(seedFor(q.id))
        if (!resumed) speakRef.current(planner.start(q))
      }
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
      audioEngine().unlock()
      const next: QuestState = { ...q, simulated: true, sim: { timeScale, noiseM: 0 }, startedAt: q.lastFixAt === undefined ? Date.now() : q.startedAt }
      questRef.current = next
      setQuest(next)
      saveQuest(next)
      startTracking(next)
    },
    [startTracking],
  )

  const end = useCallback(() => {
    audioEngine().stopMusic()
    audioEngine().stopVoice()
    plannerRef.current = undefined
    stopTracking()
    clearQuest()
    questRef.current = undefined
    setQuest(undefined)
    setPickup(undefined)
    setError(undefined)
  }, [stopTracking])

  // Pause the music when fixes stop arriving (signal lost, phone in a pocket with no GPS).
  const activeId = quest && quest.finishedAt === undefined ? quest.id : undefined
  useEffect(() => {
    if (!activeId) return
    const id = setInterval(() => {
      if (isStale(lastFixWallRef.current, Date.now())) audioEngine().setTempo(undefined)
    }, PACE_CHECK_MS)
    return () => clearInterval(id)
  }, [activeId])

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
      audioEngine().stopMusic()
      audioEngine().stopVoice()
    }
  }, [])

  return { quest, pickup, error, wakeActive, begin, end, switchToSimulation }
}
