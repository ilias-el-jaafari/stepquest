import { useEffect, useRef, useState } from 'react'
import { checkpointLine, NIGHT_LINES, shouldScare, type GhostLine } from '../ghost/director.ts'
import { nextPacerStatus, pacerElapsedMs, pacerGapM, paceFor, pausePacer, rebasePacer, resumePacer, startPacer, type Pace, type PacerPlan, type PacerStatus } from '../ghost/pacer.ts'
import type { Phase } from '../render/daylight.ts'
import { nowMs } from '../render/env.ts'
import type { QuestState } from '../quest/quest.ts'
import type { Pickup } from './useQuestRunner.ts'

/** How often the HUD status is recomputed (the ghost itself is drawn every frame by the map). */
export const STATUS_TICK_MS = 500

export type GhostSay = GhostLine & { id: number }

type Args = {
  quest: QuestState
  pickup: Pickup | undefined
  /** Light phase of the quest's clock (the demo's day cycle, `?time=` or the real time). */
  phase: Phase
  seed: number
  /** Suggested duration of the walk, minutes, when there is one. */
  durationMin?: number
}

/** The pace for a quest: from its stride, and its suggested duration when given. */
export function questPace(quest: QuestState, durationMin?: number): Pace {
  return paceFor(quest.strideM, { distanceM: quest.route.distanceM, durationMin })
}

/**
 * Everything the guide ghost does during a quest: the pacer plan (paused while the page is hidden, before
 * the first fix of a real walk and after the finish), the gap status for the HUD with hysteresis, and the
 * lines it says (gem comments and the night scare; the finish is the summary's). The map draws the ghost from `plan`.
 */
export function useGhost({ quest, pickup, phase, seed, durationMin }: Args) {
  const rate = quest.simulated ? (quest.sim?.timeScale ?? 1) : 1
  const [plan, setPlan] = useState<PacerPlan>(() => {
    const p = startPacer(nowMs(), questPace(quest, durationMin), { rate, alongM: quest.alongM })
    // A real walk waits for its first fix; a finished quest has no clock at all.
    return quest.simulated || quest.lastFixAt !== undefined ? (quest.finishedAt !== undefined ? pausePacer(p, nowMs()) : p) : pausePacer(p, nowMs())
  })
  const planRef = useRef(plan)
  const questRef = useRef(quest)
  useEffect(() => {
    planRef.current = plan
    questRef.current = quest
  })
  const update = (fn: (p: PacerPlan) => PacerPlan) => setPlan((p) => fn(p))

  // First fix of a real walk starts the clock.
  const started = quest.simulated || quest.lastFixAt !== undefined
  const finished = quest.finishedAt !== undefined
  const hidden = useRef(typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    if (finished || !started || hidden.current) update((p) => pausePacer(p, nowMs()))
    else update((p) => resumePacer(p, nowMs()))
  }, [started, finished])
  useEffect(() => {
    const onVisibility = () => {
      hidden.current = document.hidden
      const q = questRef.current
      if (document.hidden || q.finishedAt !== undefined || (!q.simulated && q.lastFixAt === undefined)) update((p) => pausePacer(p, nowMs()))
      else update((p) => resumePacer(p, nowMs()))
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // The rest of the route was recalculated: the ghost keeps its gap to the hero.
  const lastRoute = useRef({ route: quest.route, along: quest.alongM })
  useEffect(() => {
    const prev = lastRoute.current
    if (prev.route !== quest.route) update((p) => rebasePacer(p, prev.along, quest.alongM))
    lastRoute.current = { route: quest.route, along: quest.alongM }
  }, [quest.route, quest.alongM])

  // Gap status with hysteresis.
  const [status, setStatus] = useState<PacerStatus>('warmup')
  useEffect(() => {
    if (finished) return
    const id = setInterval(() => {
      const now = nowMs()
      const p = planRef.current
      const q = questRef.current
      setStatus((prev) => nextPacerStatus(prev, pacerGapM(p, now, q.alongM), pacerElapsedMs(p, now)))
    }, STATUS_TICK_MS)
    return () => clearInterval(id)
  }, [finished])

  // What the ghost says.
  const [say, setSay] = useState<GhostSay | undefined>()
  const ids = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const speak = (lines: readonly GhostLine[]) => {
    clear()
    let at = 0
    lines.forEach((line, i) => {
      const show = () => setSay({ ...line, id: ++ids.current })
      if (at === 0) show()
      else timers.current.push(setTimeout(show, at))
      at += line.ms
      if (i === lines.length - 1) timers.current.push(setTimeout(() => setSay(undefined), at))
    })
  }
  useEffect(() => clear, [])

  const lastPickup = useRef(pickup?.n ?? 0)
  useEffect(() => {
    if (!pickup || pickup.n === lastPickup.current) return
    lastPickup.current = pickup.n
    // The finish line is the finish dialogue's; the ghost celebrates from the finished state below.
    if (pickup.index < pickup.total) speak([checkpointLine(pickup.index, pickup.total, seed)])
  }, [pickup, seed])

  const scared = useRef(false)
  useEffect(() => {
    if (finished || !shouldScare(phase, scared.current)) return
    scared.current = true
    speak(NIGHT_LINES)
  }, [phase, finished])

  return { plan: finished ? undefined : plan, status: finished ? ('warmup' as const) : status, say, pace: questPace(quest, durationMin) }
}
