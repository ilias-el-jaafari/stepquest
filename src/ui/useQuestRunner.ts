import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CalloutPlanner, calloutText, predictableCallouts, sfxFor, type Callout } from '../audio/callouts.ts'
import { audioEngine } from '../audio/engine.ts'
import { isStale, PaceTracker, tempoForSpeed } from '../audio/tempo.ts'
import { useI18n } from '../i18n/index.ts'
import type { LatLon } from '../geo/geo.ts'
import { browserSource, type LocationErrorCode, type LocationSource } from '../quest/geolocation.ts'
import { gemTotal } from '../quest/gems.ts'
import { trackFor, type QuestState } from '../quest/quest.ts'
import type { ReroutePatch } from '../quest/reroute.ts'
import { QuestSession } from '../quest/session.ts'
import { simulatedSource } from '../quest/simSource.ts'
import type { GpsFix } from '../quest/types.ts'
import { keepScreenOn, type WakeLockHandle } from '../quest/wakeLock.ts'

/** How often the music checks that fixes still arrive (to pause when they stop). */
const PACE_CHECK_MS = 2000

/** A stable music seed per quest, so a resumed quest keeps its tune. */
function seedFor(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 100_000
}

/** A store that keeps nothing. */
const NO_STORE = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

export type Pickup = { n: number; point: LatLon; index: number; total: number }

function sourceFor(q: QuestState): LocationSource {
  if (!q.simulated) return browserSource()
  return simulatedSource(trackFor(q.route), {
    timeScale: q.sim?.timeScale ?? 1,
    noiseM: q.sim?.noiseM ?? 0,
    glitches: (q.sim?.noiseM ?? 0) > 0,
    tickMs: q.sim?.tickMs,
    seed: q.startedAt % 1000,
    startAlongM: q.alongM,
    startTime: q.lastFixAt !== undefined ? q.lastFixAt + 2000 : q.startedAt,
  })
}

/**
 * Connects an active quest to the outside world: the location source, sound, the wake lock
 * and React state. The rules (filter, gems, saving, step credit, reroute tickets) live in
 * `QuestSession` and `applyFix`; nothing here decides what a fix means.
 */
export function useQuestRunner(reroute?: (q: QuestState) => Promise<ReroutePatch | undefined>, opts: { persist?: boolean } = {}) {
  // The self-playing demo leaves nothing behind: its quest is never saved.
  const store = opts.persist === false ? NO_STORE : undefined
  const rerouteRef = useRef(reroute)
  useLayoutEffect(() => {
    rerouteRef.current = reroute
  })
  const [quest, setQuest] = useState<QuestState>()
  const [pickup, setPickup] = useState<Pickup>()
  const [error, setError] = useState<LocationErrorCode>()
  const [wakeActive, setWakeActive] = useState(false)
  const { t, locale } = useI18n()
  const speakRef = useRef<(c: Callout) => void>(() => {})
  const warmRef = useRef<() => void>(() => {})
  // Keep the speaker on the current language (callbacks below read it from the ref).
  useLayoutEffect(() => {
    speakRef.current = (c: Callout) => audioEngine().say(calloutText(c, t), locale, c.priority)
    warmRef.current = () =>
      audioEngine().prewarm(
        predictableCallouts().map((c) => calloutText(c, t)),
        locale,
      )
  })
  const sessionRef = useRef<QuestSession | undefined>(undefined)
  // A language change while a quest runs: phrases already queued are in the old language,
  // so drop them and pre-render the common callouts in the new one.
  const spokenLocale = useRef(locale)
  useEffect(() => {
    if (spokenLocale.current === locale) return
    spokenLocale.current = locale
    if (!sessionRef.current) return
    audioEngine().stopVoice()
    warmRef.current()
  }, [locale])
  const stopRef = useRef<(() => void) | undefined>(undefined)
  const wakeRef = useRef<WakeLockHandle | undefined>(undefined)
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

  const startReroute = useCallback(() => {
    const session = sessionRef.current
    const run = rerouteRef.current
    if (!session || !run) return
    const { ticket, snapshot } = session.startReroute()
    // The session numbers requests and refuses answers that are stale or no longer fit.
    run(snapshot)
      .then((patch) => {
        const next = session.settleReroute(ticket, patch)
        if (next) setQuest(next)
      })
      .catch(() => {
        // A failed request changes nothing; the next off-route stretch asks again.
      })
  }, [])

  const onFix = useCallback(
    (fix: GpsFix) => {
      const session = sessionRef.current
      // A finished quest ignores late fixes (the watch is stopped, but one may already be queued).
      if (!session?.running) return
      const { prev: current, state, events, wantsReroute } = session.handleFix(fix)
      // Still heading for the goal off the line: quietly recalculate the rest of the route
      // (in the worker; the answer is merged in when it arrives, the fix handler never waits).
      if (wantsReroute) startReroute()
      setError(undefined)
      const audio = audioEngine()
      // Sound: effects, spoken callouts and the music tempo from the walking pace.
      for (const name of sfxFor(events, state)) audio.playSfx(name)
      for (const c of plannerRef.current?.update(current, state, events) ?? []) speakRef.current(c)
      lastFixWallRef.current = Date.now()
      paceRef.current.push(state.odometer.totalM, fix.timestamp)
      if (state.finishedAt === undefined) audio.setTempo(tempoForSpeed(paceRef.current.speed(), state.strideM))
      for (const e of events) {
        if (e.type === 'collected') {
          pickupCount.current++
          setPickup({ n: pickupCount.current, point: e.point, index: e.index, total: gemTotal(state.route) })
        }
        if (e.type === 'finished') {
          audio.stopMusic()
          // Stop watchPosition (and the wake lock) as soon as the quest is complete.
          stopTracking()
          setError(undefined)
        }
      }
      setQuest(state)
    },
    [stopTracking, startReroute],
  )

  const startTracking = useCallback(
    (q: QuestState) => {
      stopTracking()
      if (q.finishedAt !== undefined) return
      stopRef.current = sourceFor(q).start(onFix, (code) => {
        // Late errors after the quest ended or finished are ignored.
        if (sessionRef.current?.running) setError(code)
      })
      wakeRef.current = keepScreenOn(undefined, undefined, setWakeActive)
    },
    [onFix, stopTracking],
  )

  /** Start a new quest (call from a click so audio and wake lock are allowed). */
  const begin = useCallback(
    (q: QuestState, resumed = false, gesture = !resumed) => {
      const audio = audioEngine()
      // A fresh start runs inside the "Start quest" click, which unlocks audio (iOS).
      // After a reload (or in the self-playing demo) there is no gesture yet: sound starts on the first tap.
      if (!gesture) audio.armUnlock()
      else audio.unlock()
      audio.stopVoice()
      sessionRef.current?.cancelReroute()
      paceRef.current.reset()
      lastFixWallRef.current = undefined
      const planner = new CalloutPlanner(q)
      plannerRef.current = planner
      if (q.finishedAt === undefined) {
        audio.startMusic(seedFor(q.id))
        if (!resumed) speakRef.current(planner.start(q))
        warmRef.current()
      }
      const session = new QuestSession(q, { store })
      sessionRef.current = session
      session.save()
      setQuest(session.state)
      setPickup(undefined)
      setError(undefined)
      startTracking(session.state)
    },
    [startTracking, store],
  )

  /** Switch a running quest to the simulator (e.g. after permission was denied). */
  const switchToSimulation = useCallback(
    (timeScale = 20) => {
      const session = sessionRef.current
      const q = session?.state
      if (!session || !q) return
      audioEngine().unlock()
      const next: QuestState = { ...q, simulated: true, sim: { timeScale, noiseM: 0 }, startedAt: q.lastFixAt === undefined ? Date.now() : q.startedAt }
      session.replace(next)
      setQuest(session.state)
      startTracking(session.state)
    },
    [startTracking],
  )

  const end = useCallback(() => {
    // Back to the planning screen: the quest tune slows into the calm menu music.
    audioEngine().playMenuMusic()
    audioEngine().stopVoice()
    plannerRef.current = undefined
    stopTracking()
    sessionRef.current?.end()
    sessionRef.current = undefined
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
    const save = () => sessionRef.current?.save()
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
      stopRef.current?.()
      stopRef.current = undefined
      wakeRef.current?.release()
      wakeRef.current = undefined
      sessionRef.current?.dispose()
      audioEngine().stopMusic()
      audioEngine().stopVoice()
    }
  }, [])

  return { quest, pickup, error, wakeActive, begin, end, switchToSimulation }
}
