import { useI18n } from '../i18n/index.ts'
import type { OverpassErrorCode } from '../osm/overpass.ts'

type Props = {
  picking: boolean
  /** The last avoid-street tap found no street. */
  noStreet: boolean
  /** Megabytes text while a download runs. */
  loadingMb: string | undefined
  outsideView: boolean
  askHere: boolean
  errorCode: OverpassErrorCode | undefined
  onCancelPick: () => void
  onLoadView: () => void
  onLocate: () => void
  onDismissAsk: () => void
}

/** Banners over the map: picking a street, loading an area, or offering the walker's position. */
export function MapBanners(p: Props) {
  const { t } = useI18n()
  const pickBanner = p.picking || p.noStreet
  const areaBanner = !p.picking && !p.noStreet && (p.loadingMb !== undefined || p.outsideView || p.askHere)
  return (
    <>
      {pickBanner && (
        <div className="map-banner" role="status">
          <span>{p.picking ? t('safety.picking') : t('safety.noStreet')}</span>
          <button type="button" className="pix-btn small-text" onClick={p.onCancelPick}>
            {t('safety.cancel')}
          </button>
        </div>
      )}
      {areaBanner && (
        <div className="map-banner area-toast" role="status" data-testid="area-toast">
          {p.loadingMb !== undefined ? (
            <span>{t('area.loading', { mb: p.loadingMb })}</span>
          ) : p.outsideView ? (
            <>
              <span>{t('area.outside')}</span>
              {p.errorCode && <span className="area-error">{t(`data.err.${p.errorCode}`)}</span>}
              <button type="button" className="pix-btn small-text" onClick={p.onLoadView} data-testid="load-area">
                {t('area.load')}
              </button>
            </>
          ) : (
            <>
              <span>{t('area.askHere')}</span>
              <button type="button" className="pix-btn small-text" onClick={p.onLocate}>
                {t('loc.use')}
              </button>
              <button type="button" className="pix-btn small-text" onClick={p.onDismissAsk} aria-label={t('info.close')}>
                ×
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
