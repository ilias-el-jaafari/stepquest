import type { QuestStats } from './stats.ts'

/** Which end-of-quest screen: the flag was reached, or the player stopped early. */
export type SummaryKind = 'complete' | 'paused'

export type TitleId = 'scout' | 'hero' | 'wayfarer' | 'legend' | 'swift' | 'fresh' | 'seeker'

export type Summary = {
  kind: SummaryKind
  walkedM: number
  steps: number
  elapsedMs: number
  /** Minutes per kilometre; undefined until 50 m have been walked. */
  paceMinPerKm: number | undefined
  collected: number
  total: number
  title: TitleId
}

/** Titles a paused quest can earn, and the ones a completed quest can earn. */
export const PAUSED_TITLES: readonly TitleId[] = ['fresh', 'seeker']
export const COMPLETE_TITLES: readonly TitleId[] = ['scout', 'hero', 'wayfarer', 'legend', 'swift']

/** A quick walk: 8 min/km or faster over at least 3,000 steps. */
const SWIFT_PACE = 8
const SWIFT_MIN_STEPS = 3000

const count = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)

/** The title earned: a pure function of the variant, steps, pace and gems. */
export function titleFor(kind: SummaryKind, steps: number, paceMinPerKm: number | undefined, collected: number): TitleId {
  const s = count(steps)
  if (kind === 'paused') return count(collected) > 0 ? 'seeker' : 'fresh'
  if (s >= 20000) return 'legend'
  if (s >= 10000) return 'wayfarer'
  if (paceMinPerKm !== undefined && Number.isFinite(paceMinPerKm) && paceMinPerKm > 0 && paceMinPerKm <= SWIFT_PACE && s >= SWIFT_MIN_STEPS) return 'swift'
  if (s >= 5000) return 'hero'
  return 'scout'
}

/** What the summary screen shows, from the quest stats. Bad numbers count as 0 and gems stay within 0..total. */
export function summarize(stats: QuestStats, kind: SummaryKind): Summary {
  const total = Math.floor(count(stats.total))
  const collected = Math.min(total, Math.floor(count(stats.collected)))
  const walkedM = count(stats.walkedM)
  const steps = Math.round(count(stats.steps))
  const pace = stats.paceMinPerKm
  const paceMinPerKm = walkedM >= 50 && pace !== undefined && Number.isFinite(pace) && pace >= 0 ? pace : undefined
  return { kind, walkedM, steps, elapsedMs: count(stats.elapsedMs), paceMinPerKm, collected, total, title: titleFor(kind, steps, paceMinPerKm, collected) }
}
