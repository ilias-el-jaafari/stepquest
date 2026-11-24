import { useI18n } from '../i18n/index.ts'
import type { LocateStatus } from '../app/appState.ts'

/** The outcome of "use my location" in words. */
export function LocateMessage({ status }: { status: LocateStatus }) {
  const { t } = useI18n()
  switch (status.state) {
    case 'loadingArea':
      return <p className="hint">{t('loc.loadingArea')}</p>
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
