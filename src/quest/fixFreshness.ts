import type { GpsFix } from './types.ts'

/** A browser fix older than this against the device clock is a cached position (page was in the background). */
export const MAX_FIX_AGE_MS = 30_000
/** A fix this far ahead of the device clock would freeze the filter; it is dropped. */
export const MAX_FIX_AHEAD_MS = 60_000

/** Whether a fix from the browser is recent enough to use. Not for the simulator (it has its own clock). */
export function isFreshFix(fix: GpsFix, nowMs: number): boolean {
  if (!Number.isFinite(fix.timestamp)) return false
  const age = nowMs - fix.timestamp
  return age <= MAX_FIX_AGE_MS && age >= -MAX_FIX_AHEAD_MS
}
