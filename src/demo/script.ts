import type { Locale } from '../i18n/locale.ts'
import { DEFAULT_SIM } from '../quest/simulate.ts'
import type { Settings } from '../ui/settings.ts'

/** What `?demo=1` asks for. `lang` is the optional `&lang=es|en`. */
export type DemoParams = { lang: Locale | undefined }

/** `?demo=1` (and `&lang=es|en`): the self-playing run. Anything else is a normal visit. */
export function parseDemo(search: string): DemoParams | undefined {
  const q = new URLSearchParams(search)
  if (q.get('demo') !== '1') return undefined
  const lang = q.get('lang')?.trim().toLowerCase()
  return { lang: lang === 'es' || lang === 'en' ? lang : undefined }
}

/** The plan of the run: a loop of about 4.5 km (6 gems) in the bundled Benicalap area. */
export const DEMO_SETTINGS: Settings = { mode: 'loop', targetSteps: 6000, strideM: 0.75 }

/** Real seconds the walk itself takes (planning and the finish dialogue come on top: about 72 s to the summary). */
export const DEMO_WALK_SECONDS = 62

/** The day cycle of the run: late afternoon, sunset, night (minutes after local midnight). */
export const DEMO_CLOCK = { fromMin: 18 * 60 + 30, toMin: 22 * 60 + 30 } as const

/** A fixed quest id: the same tune and the same fireworks every run. */
export const DEMO_QUEST_ID = 'qdemo'

/**
 * Midnight of the run's day in València (21 June 2026, CEST = UTC+2). A fixed summer day, so 18:30
 * is still afternoon and the sun sets during the walk, whatever the day and time zone of the recording.
 */
export const DEMO_DAY_MS = Date.UTC(2026, 5, 21) - 2 * 3_600_000

/** Real milliseconds between simulator ticks: small steps keep the camera and the walker smooth. */
export const DEMO_TICK_MS = 100

/** In the run, a dialogue line moves on by itself after this long, and the finish dialogue closes after this long. */
export const DEMO_NEXT_LINE_MS = 2500
export const DEMO_FINISH_CLOSE_MS = 3000

/** Zoom (screen px per tile) of the close shots. */
export const DEMO_CLOSE_ZOOM = 24

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)
const smooth = (x: number) => x * x * (3 - 2 * x)

/** Simulated seconds per real second so that a route of `distanceM` is walked in `walkSeconds` (the run's length by default). */
export function demoTimeScale(distanceM: number, walkSeconds = DEMO_WALK_SECONDS): number {
  const walkS = distanceM / (DEFAULT_SIM.speedKmh / 3.6)
  return Math.max(1, Math.round((walkS / walkSeconds) * 100) / 100)
}

/** How far along the route the walker is, 0..1 (1 once the quest is finished). */
export function demoProgress(alongM: number, totalM: number, finished: boolean): number {
  if (finished) return 1
  return totalM > 0 ? clamp01(alongM / totalM) : 0
}

/** The day-cycle clock for a progress: from late afternoon to night, in a straight line. */
export function demoClockMinutes(progress: number): number {
  return DEMO_CLOCK.fromMin + (DEMO_CLOCK.toMin - DEMO_CLOCK.fromMin) * clamp01(progress)
}

/** The run's day-cycle moment (epoch ms) for a progress, in whole minutes. */
export function demoClockAt(progress: number): number {
  return DEMO_DAY_MS + Math.round(demoClockMinutes(progress)) * 60_000
}

/** Where the camera pulls out and comes back, as fractions of the route walked. */
const SHOTS = { closeUntil: 0.1, wholeFrom: 0.28, wholeUntil: 0.62, closeFrom: 0.8 } as const

/** 0 = close on the walker, 1 = the whole route in view; eased in and out. */
export function demoCameraBlend(progress: number): number {
  const p = clamp01(progress)
  const { closeUntil, wholeFrom, wholeUntil, closeFrom } = SHOTS
  if (p <= closeUntil) return 0
  if (p < wholeFrom) return smooth((p - closeUntil) / (wholeFrom - closeUntil))
  if (p <= wholeUntil) return 1
  return p < closeFrom ? 1 - smooth((p - wholeUntil) / (closeFrom - wholeUntil)) : 0
}

export type DemoEvent = 'closeUp' | 'pullOut' | 'wholeRoute' | 'comeBack' | 'closeAgain' | 'arrive'

/** The camera script in real seconds of the walk (fixed for every run). */
export function demoTimeline(): { atS: number; event: DemoEvent }[] {
  const at = (p: number) => Math.round(p * DEMO_WALK_SECONDS * 10) / 10
  return [
    { atS: 0, event: 'closeUp' },
    { atS: at(SHOTS.closeUntil), event: 'pullOut' },
    { atS: at(SHOTS.wholeFrom), event: 'wholeRoute' },
    { atS: at(SHOTS.wholeUntil), event: 'comeBack' },
    { atS: at(SHOTS.closeFrom), event: 'closeAgain' },
    { atS: DEMO_WALK_SECONDS, event: 'arrive' },
  ]
}

/**
 * The demo's ghost choreography (the real pacer is untouched): gap in metres between the hero and the pace point
 * (positive = hero ahead) against real seconds of the walk. Wisp starts 34 m ahead ("behind"), the hero catches up
 * by about 10 s ("on pace"), later pulls ahead ("ahead"), then settles back. The hero's own speed stays constant, so
 * its progress is as monotonic as in any other run; the ghost slows and speeds up relative to it.
 */
export const DEMO_GAP_KEYS: readonly (readonly [number, number])[] = [
  [0, -34],
  [5, -34],
  [10, 0],
  [28, 0],
  [33, 38],
  [44, 38],
  [52, 5],
  [DEMO_WALK_SECONDS, 0],
]

/** Scripted gap at `walkSeconds` real seconds into the walk (linear between keys). */
export function demoGapM(walkSeconds: number): number {
  const keys = DEMO_GAP_KEYS
  if (!(walkSeconds > 0)) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, g1] = keys[i]!
    if (walkSeconds <= t1) {
      const [t0, g0] = keys[i - 1]!
      return g0 + ((g1 - g0) * (walkSeconds - t0)) / (t1 - t0)
    }
  }
  return keys[keys.length - 1]![1]
}

/** The pacer's `gapScript` for a run whose simulator runs `rate` times faster than real time. */
export function demoGapScript(rate: number): (elapsedMs: number) => number {
  const r = rate > 0 ? rate : 1
  return (elapsedMs) => demoGapM(elapsedMs / 1000 / r)
}
