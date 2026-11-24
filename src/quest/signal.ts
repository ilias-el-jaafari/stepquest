import type { QuestState } from './state.ts'

/** A real quest with no accepted fix for this long shows "no signal". */
export const LOST_AFTER_MS = 30_000
/** Fixes rejected for poor accuracy for this long show "weak signal". */
export const WEAK_AFTER_MS = 5_000

export type SignalStatus = 'finished' | 'lost' | 'weak' | 'ok'

/**
 * GPS signal as the HUD shows it. Finished quests show nothing. The simulator has no
 * signal to lose. `now` is the wall clock (fix timestamps come from the device clock).
 */
export function signalStatus(q: QuestState, now: number): SignalStatus {
  if (q.finishedAt !== undefined) return 'finished'
  if (!q.simulated && q.lastFixAt !== undefined && now - q.lastFixAt > LOST_AFTER_MS) return 'lost'
  if (q.weakSince !== undefined && now - q.weakSince > WEAK_AFTER_MS) return 'weak'
  return 'ok'
}
