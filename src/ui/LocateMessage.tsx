import { useI18n } from '../i18n/index.ts'
import type { LocateStatus } from '../app/appState.ts'

/** The outcome of "use my location" in words. */
export function LocateMessage({ status, onRetry }: { status: LocateStatus; onRetry?: () => void }) {
  const { t } = useI18n()
  switch (status.state) {
    case 'loadingArea':
      return <p className="hint">{t('loc.loadingArea')}</p>
    case 'areaError':
      return (
        <div className="msg bad" role="alert" data-testid="locate-area-error">
          <p>{t('loc.areaFailed')}</p>
          {onRetry && (
            <button type="button" className="pix-btn small-text" onClick={onRetry}>
              {t('action.retry')}
            </button>
          )}
        </div>
      )
    case 'ok':
      return <p className={status.weak ? 'msg bad' : 'hint'}>{t(status.weak ? 'loc.weak' : 'loc.found', { m: Math.round(status.accuracy) })}</p>
    case 'error':
      return (
        <p className="msg bad" data-testid="locate-error">
          {t(`loc.err.${status.code}`, { m: Math.round(status.accuracy ?? 0) })}
        </p>
      )
    default:
      return null
  }
}
