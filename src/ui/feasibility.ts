import type { Translate } from '../i18n/index.ts'
import type { PlanResult } from '../routing/planner.ts'
import { formatNumber } from '../i18n/format.ts'
import type { Locale } from '../i18n/index.ts'

export type Feasibility = { text: string; ok: boolean; suggest?: number }

/** A plan's outcome in words: "Route ready", or why there is none, with the nearest number of steps that fits (requirement 12.5). */
export function feasibility(result: PlanResult | undefined, t: Translate, locale: Locale): Feasibility | undefined {
  if (!result) return undefined
  const n = (v: number) => formatNumber(v, locale)
  if (result.ok) return { text: t('result.ready', { n: result.route.checkpoints.length }), ok: true }
  switch (result.reason) {
    case 'tooShort':
      return { text: t(result.closest?.mode === 'loop' ? 'error.tooShortLoop' : 'error.tooShort', { min: n(result.minSteps ?? 0) }), ok: false, suggest: Math.ceil((result.minSteps ?? 0) / 100) * 100 }
    case 'tooLong':
      return { text: t('error.tooLong', { max: n(result.maxSteps ?? 0) }), ok: false, suggest: Math.floor((result.maxSteps ?? 0) / 100) * 100 }
    case 'outOfRange':
      return { text: t('error.outOfRange', { min: n(result.minSteps ?? 0), max: n(result.maxSteps ?? 0) }), ok: false }
    case 'noMatch':
      return { text: t('error.noMatch', { steps: n(result.closest?.steps ?? 0) }), ok: false }
    default:
      return { text: t(`error.${result.reason}`), ok: false }
  }
}
