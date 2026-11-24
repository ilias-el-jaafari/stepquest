import { useSyncExternalStore } from 'react'
import { useI18n } from '../i18n/index.ts'
import { updateStore } from '../pwa/updateStore.ts'

/** "A new version is ready": shown on the planning screens only, so a quest is never interrupted. */
export function UpdateBanner() {
  const { t } = useI18n()
  const { updateReady } = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot, updateStore.getSnapshot)
  if (!updateReady) return null
  return (
    <div className="net-banner update-banner" role="status" data-testid="update-banner">
      <span>{t('update.ready')}</span>
      <button type="button" className="pix-btn small-text" data-testid="update-apply" onClick={updateStore.apply}>
        {t('update.apply')}
      </button>
      <button type="button" className="pix-btn small-text" onClick={updateStore.dismiss}>
        {t('update.later')}
      </button>
    </div>
  )
}
