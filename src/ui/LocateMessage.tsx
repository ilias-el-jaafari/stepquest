import { GhostNote } from './GhostNote.tsx'
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
        <GhostNote role="alert" testId="locate-area-error">
          <p>{t('loc.areaFailed')}</p>
          {onRetry && (
            <button type="button" className="pix-btn small-text" onClick={onRetry}>
              {t('action.retry')}
            </button>
          )}
        </GhostNote>
      )
    case 'ok':
      return status.weak ? <GhostNote>{t('loc.weak', { m: Math.round(status.accuracy) })}</GhostNote> : <p className="hint">{t('loc.found', { m: Math.round(status.accuracy) })}</p>
    case 'error':
      return <GhostNote testId="locate-error">{t(`loc.err.${status.code}`, { m: Math.round(status.accuracy ?? 0) })}</GhostNote>
    default:
      return null
  }
}
