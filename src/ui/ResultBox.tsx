import { useI18n } from '../i18n/index.ts'
import { formatKm, formatNumber, formatSignedPercent } from '../i18n/format.ts'
import { STEPS_PER_CHECKPOINT } from '../routing/checkpoints.ts'
import type { PlanResult } from '../routing/planner.ts'
import { WALK_KMH } from '../app/constants.ts'

/** The quest log: distance, steps, checkpoints and time of the route, or why none fits. */
export function ResultBox({ result, onUseSteps }: { result: PlanResult | undefined; onUseSteps: (steps: number) => void }) {
  const { t, locale } = useI18n()
  const route = result?.ok ? result.route : result?.closest
  const n = (v: number) => formatNumber(v, locale)
  let message: { text: string; ok: boolean; suggest?: number } | undefined
  if (result?.ok) message = { text: t('result.ready', { n: result.route.checkpoints.length }), ok: true }
  else if (result) {
    switch (result.reason) {
      case 'tooShort':
        message = { text: t(result.closest?.mode === 'loop' ? 'error.tooShortLoop' : 'error.tooShort', { min: n(result.minSteps ?? 0) }), ok: false, suggest: Math.ceil((result.minSteps ?? 0) / 100) * 100 }
        break
      case 'tooLong':
        message = { text: t('error.tooLong', { max: n(result.maxSteps ?? 0) }), ok: false, suggest: Math.floor((result.maxSteps ?? 0) / 100) * 100 }
        break
      case 'outOfRange':
        message = { text: t('error.outOfRange', { min: n(result.minSteps ?? 0), max: n(result.maxSteps ?? 0) }), ok: false }
        break
      case 'noMatch':
        message = { text: t('error.noMatch', { steps: n(result.closest?.steps ?? 0) }), ok: false }
        break
      default:
        message = { text: t(`error.${result.reason}`), ok: false }
    }
  }
  return (
    <div className="box result" aria-live="polite">
      <h2 className="box-title">{t('result.title')}</h2>
      {!result && <p className="hint">{t('result.empty')}</p>}
      {route && (
        <dl className="stats">
          <div>
            <dt>{t('result.distance')}</dt>
            <dd data-testid="distance">{formatKm(route.distanceM, locale)}</dd>
          </div>
          <div>
            <dt>{t('result.steps')}</dt>
            <dd data-testid="steps">
              {n(route.steps)}{' '}
              <small>{t('result.vsTarget', formatSignedPercent(route.error, locale))}</small>
            </dd>
          </div>
          <div>
            <dt>{t('result.checkpoints')}</dt>
            <dd>{t('result.checkpointsValue', { n: route.checkpoints.length, every: n(Math.round(route.steps / Math.max(1, route.checkpoints.length) / 10) * 10 || STEPS_PER_CHECKPOINT) })}</dd>
          </div>
          <div>
            <dt>{t('result.time')}</dt>
            <dd>{t('result.timeValue', { min: Math.round((route.distanceM / 1000 / WALK_KMH) * 60) })}</dd>
          </div>
        </dl>
      )}
      {message && (
        <p className={`msg ${message.ok ? 'good' : 'bad'}`} data-testid="feasibility">
          {message.text}
          {!message.ok && route && <> {t('error.preview')}</>}
        </p>
      )}
      {message?.suggest ? (
        <button type="button" className="pix-btn" onClick={() => onUseSteps(message.suggest!)}>
          {t('action.useSteps', { steps: n(message.suggest) })}
        </button>
      ) : null}
    </div>
  )
}
