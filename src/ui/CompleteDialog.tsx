import { useId, useRef } from 'react'
import { formatDistance, formatNumber } from '../i18n/format.ts'
import { useI18n } from '../i18n/index.ts'
import { formatDuration, formatPace } from '../quest/quest.ts'
import { useModal } from './useModal.ts'

type Props = {
  /** Checkpoints collected. */
  total: number
  walkedM: number
  steps: number
  elapsedMs: number
  paceMinPerKm: number | undefined
  targetSteps: number
  onNew: () => void
}

/** The "Quest complete!" results screen: a modal dialog whose only exit is the "New quest" button. */
export function CompleteDialog(p: Props) {
  const { t, locale } = useI18n()
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModal(panel)
  return (
    <div className="complete" data-testid="complete">
      <div ref={panel} className="complete-box" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="stars" aria-hidden="true">
          ★ ★ ★
        </div>
        <h2 id={titleId}>{t('complete.title')}</h2>
        <p>{t('complete.subtitle', { n: p.total })}</p>
        <dl className="complete-stats">
          <div>
            <dt>{t('complete.distance')}</dt>
            <dd>{formatDistance(p.walkedM, locale)}</dd>
          </div>
          <div>
            <dt>{t('complete.steps')}</dt>
            <dd>{formatNumber(p.steps, locale)}</dd>
          </div>
          <div>
            <dt>{t('complete.time')}</dt>
            <dd>{formatDuration(p.elapsedMs)}</dd>
          </div>
          <div>
            <dt>{t('complete.pace')}</dt>
            <dd>
              {formatPace(p.paceMinPerKm)}
              {t('quest.paceUnit')}
            </dd>
          </div>
          <div className="wide">
            <dt>{t('complete.goal')}</dt>
            <dd>{t('complete.goalValue', { steps: formatNumber(p.targetSteps, locale) })}</dd>
          </div>
        </dl>
        <button type="button" className="pix-btn primary" data-autofocus onClick={p.onNew}>
          {t('complete.new')}
        </button>
      </div>
    </div>
  )
}
