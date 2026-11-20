import { DEFAULT_STRIDE_M, MAX_STEPS, MAX_STRIDE_M, MIN_STEPS, MIN_STRIDE_M } from '../geo/steps.ts'

/** Slider range for the step goal; typed values outside it are still allowed. */
export const SLIDER_MIN = 500
export const SLIDER_MAX = 30_000
export const SLIDER_STEP = 500

export type Parsed = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'number'; value: number }

/** Parse a typed step count. Accepts thousands separators ("2.000", "2,000", "2 000"). */
export function parseStepsText(text: string): Parsed {
  const s = text.trim().replace(/[\s.,'_\u00a0\u202f]/g, '')
  if (s === '') return { kind: 'empty' }
  if (!/^\d+$/.test(s)) return { kind: 'invalid' }
  return { kind: 'number', value: Number(s) }
}

/** Parse a typed stride in metres. Accepts a decimal comma ("0,75") or point. */
export function parseStrideText(text: string): Parsed {
  const s = text.trim().replace(',', '.')
  if (s === '') return { kind: 'empty' }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { kind: 'invalid' }
  return { kind: 'number', value: Number(s) }
}

export type Committed = {
  value: number
  /** Why the typed text was changed, if it was. */
  note?: 'low' | 'high' | 'invalid'
}

function commit(parsed: Parsed, min: number, max: number, fallback: number, round: (n: number) => number): Committed {
  if (parsed.kind !== 'number') return { value: fallback, note: 'invalid' }
  const v = round(parsed.value)
  if (v < min) return { value: min, note: 'low' }
  if (v > max) return { value: max, note: 'high' }
  return { value: v }
}

/** Validate and clamp a typed step goal (on blur, Enter or Plan). Empty or garbage keeps `fallback`. */
export function commitSteps(text: string, fallback: number): Committed {
  return commit(parseStepsText(text), MIN_STEPS, MAX_STEPS, fallback, Math.round)
}

/** Validate and clamp a typed stride (on blur, Enter or Plan). */
export function commitStride(text: string, fallback: number = DEFAULT_STRIDE_M): Committed {
  return commit(parseStrideText(text), MIN_STRIDE_M, MAX_STRIDE_M, fallback, (n) => Math.round(n * 100) / 100)
}

/** A value typed so far that is already usable (in range), else undefined. Used for live sync while typing. */
export function liveSteps(text: string): number | undefined {
  const p = parseStepsText(text)
  return p.kind === 'number' && p.value >= MIN_STEPS && p.value <= MAX_STEPS ? p.value : undefined
}

export function liveStride(text: string): number | undefined {
  const p = parseStrideText(text)
  return p.kind === 'number' && p.value >= MIN_STRIDE_M && p.value <= MAX_STRIDE_M ? Math.round(p.value * 100) / 100 : undefined
}

/** Slider position for a step goal: clamped into the slider range and snapped to its step. */
export function sliderValue(steps: number): number {
  const v = Math.round(steps / SLIDER_STEP) * SLIDER_STEP
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v))
}

/** Text shown in the stride field for a value. */
export function formatStride(m: number): string {
  return String(Math.round(m * 100) / 100)
}
