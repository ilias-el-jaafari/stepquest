import { useI18n } from '../i18n/index.ts'
import type { SafePlan } from '../routing/safePlanner.ts'

export function SafetyNotice({ plan, usingNormal, onUseNormal }: { plan: SafePlan; usingNormal: boolean; onUseNormal: () => void }) {
  const { t } = useI18n()
  const lines: { text: string; ok: boolean }[] = []
  if (usingNormal) lines.push({ text: t('safety.usingNormal'), ok: false })
  else {
    if (plan.notice === 'safeInfeasible') lines.push({ text: t('safety.infeasible'), ok: false })
    if (plan.notice === 'avoidIgnored' && plan.avoidedUsed?.length) {
      lines.push({ text: t('safety.avoidIgnored', { names: plan.avoidedUsed.join(', '), n: plan.avoidedUsed.length }), ok: false })
    }
  }
  if (lines.length === 0) return null
  return (
    <div className="box safety-notice" aria-live="polite" data-testid="safety-notice">
      {lines.map((l) => (
        <p key={l.text} className={l.ok ? 'hint' : 'msg bad'}>
          {l.text}
        </p>
      ))}
      {plan.normal && !usingNormal && (
        <div className="actions">
          <button type="button" className="pix-btn" onClick={onUseNormal}>
            {t('safety.useNormal')}
          </button>
        </div>
      )}
    </div>
  )
}
