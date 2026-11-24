export const DEFAULT_STRIDE_M = 0.75
export const MIN_STRIDE_M = 0.4
export const MAX_STRIDE_M = 1.2
export const MIN_STEPS = 100
export const MAX_STEPS = 60_000
/** Routes count as a match when they land within this fraction of the target. */
export const TARGET_TOLERANCE = 0.05

export function clampStride(stride: number): number {
  if (!Number.isFinite(stride)) return DEFAULT_STRIDE_M
  return Math.min(MAX_STRIDE_M, Math.max(MIN_STRIDE_M, stride))
}

/**
 * A stride as the app stores and shows it: inside the bounds and in whole
 * centimetres, so the number on screen is the number the planner uses.
 */
export function roundStride(stride: number): number {
  return Math.round(clampStride(stride) * 100) / 100
}

export function stepsToMetres(steps: number, strideM: number = DEFAULT_STRIDE_M): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0
  return steps * clampStride(strideM)
}

export function metresToSteps(metres: number, strideM: number = DEFAULT_STRIDE_M): number {
  if (!Number.isFinite(metres) || metres <= 0) return 0
  return Math.round(metres / clampStride(strideM))
}

/** Rough stride from body height (a common 0.415 × height rule of thumb). */
export function strideFromHeightCm(heightCm: number): number {
  return clampStride(Math.round(heightCm * 0.415) / 100)
}

export function withinTolerance(actual: number, target: number, tolerance = TARGET_TOLERANCE): boolean {
  if (target <= 0) return false
  return Math.abs(actual - target) <= target * tolerance
}
