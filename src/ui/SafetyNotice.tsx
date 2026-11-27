import { useI18n } from '../i18n/index.ts'
import { GhostNote } from './GhostNote.tsx'
import type { SafePlan } from '../routing/safePlanner.ts'

export function SafetyNotice({ plan, usingNormal, onUseNormal }: { plan: SafePlan; usingNormal: boolean; onUseNormal: () => void }) {
  const { t } = useI18n()
  const lines: { text: string; ok: boolean }[] = []
  if (usingNormal) {
    lines.push({ text: t('safety.usingNormal'), ok: false })
    if (plan.normalAvoidedUsed?.length) {
      lines.push({ text: t('safety.avoidIgnored', { names: plan.normalAvoidedUsed.join(', '), n: plan.normalAvoidedUsed.length }), ok: false })
    }
  } else {
    if (plan.notice === 'safeInfeasible') lines.push({ text: t('safety.infeasible'), ok: false })
    if (plan.notice === 'avoidIgnored' && plan.avoidedUsed?.length) {
      lines.push({ text: t('safety.avoidIgnored', { names: plan.avoidedUsed.join(', '), n: plan.avoidedUsed.length }), ok: false })
    }
  }
  if (lines.length === 0) return null
  return (
    <div className="box safety-notice" aria-live="polite" data-testid="safety-notice">
      {lines.map((l) =>
        l.ok ? (
          <p key={l.text} className="hint">
            {l.text}
          </p>
        ) : (
          <GhostNote key={l.text}>{l.text}</GhostNote>
        ),
      )}
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
