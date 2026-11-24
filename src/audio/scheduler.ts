/**
 * Look-ahead step scheduler for the music (the "two clocks" pattern): a
 * coarse timer asks which sixteenth-note steps fall inside the next window
 * of audio time, and each step is scheduled sample-accurately on the
 * AudioContext clock. Pure, so it can be tested without audio.
 */

import { sanitizeBpm } from './tempo.ts'

export type ClockState = {
  /** Audio time (s) of the next step to schedule. */
  nextTime: number
  /** Index of the next step (sixteenth notes since the start). */
  step: number
}

export type ScheduledStep = { step: number; time: number; duration: number }

/** Length of one sixteenth note at a tempo. */
export function stepSeconds(bpm: number): number {
  return 60 / (sanitizeBpm(bpm) ?? 100) / 4
}

/**
 * How far ahead (seconds) to schedule. A hidden tab may run the timer only once
 * a second, so it needs much more than a visible one.
 */
export function lookaheadFor(hidden: boolean): number {
  return hidden ? 1.5 : 0.15
}

/**
 * Steps due between now and now + lookahead. If the clock fell behind (tab
 * was asleep, context suspended) it jumps forward instead of bursting out
 * every missed note.
 */
export function scheduleWindow(state: ClockState, now: number, lookahead: number, bpm: number | ((step: number) => number)): { steps: ScheduledStep[]; state: ClockState } {
  const tempo = typeof bpm === 'function' ? bpm : () => bpm
  let { nextTime, step } = state
  if (!Number.isFinite(nextTime) || !Number.isFinite(now)) nextTime = Number.isFinite(now) ? now + 0.02 : 0
  if (nextTime < now - 0.05) nextTime = now + 0.02
  const steps: ScheduledStep[] = []
  // Guard against a silly lookahead producing thousands of steps.
  while (nextTime < now + lookahead && steps.length < 64) {
    const duration = stepSeconds(tempo(step))
    steps.push({ step, time: nextTime, duration })
    nextTime += duration
    step++
  }
  return { steps, state: { nextTime, step } }
}
