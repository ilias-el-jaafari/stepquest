import { DEMO_AREA } from '../osm/demoArea.ts'
import { formatCoord } from '../geo/coords.ts'
import type { LatLon } from '../geo/geo.ts'
import { useI18n, type Locale } from '../i18n/index.ts'
import { InfoMenu } from './InfoMenu.tsx'
import { SoundControls } from './SoundMenu.tsx'
import type { LiveStatus } from './useMapData.ts'

type Props = {
  start: LatLon
  /** Moment for "today" in the sunrise and sunset line. */
  now: number
  isDemo: boolean
  coordsText: string
  coordsError: boolean
  liveStatus: LiveStatus
  onCoordsText: (text: string) => void
  onLoadLive: () => void
  onBackToDemo: () => void
  onShowIntro: () => void
}

/** Settings tab: sound, language, help, the intro and the map data. */
export function SettingsContent(p: Props) {
  const { t, locale, setLocale } = useI18n()
  const loading = p.liveStatus.state === 'loading'
  return (
    <>
      <div className="box">
        <h2 className="box-title">{t('settings.sound')}</h2>
        <div className="sound-inline">
          <SoundControls />
        </div>
      </div>
      <div className="box">
        <label className="field lang">
          <span className="box-title">{t('settings.language')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('lang.switchTo')}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <div className="box">
        <h2 className="box-title">{t('settings.about')}</h2>
        <InfoMenu place={p.start} now={p.now} />
        <button type="button" className="pix-btn" data-testid="show-intro" onClick={p.onShowIntro}>
          {t('onboarding.show')}
        </button>
      </div>
      <div className="box">
        <h2 className="box-title">{t('data.label')}</h2>
        <p className="hint">{p.isDemo ? t('data.demo', { name: DEMO_AREA.name }) : t('data.live', { lat: formatCoord(p.start.lat), lon: formatCoord(p.start.lon) })}</p>
        <p className="hint">{t('data.howTo')}</p>
        <details className="advanced">
          <summary>{t('data.advanced')}</summary>
          <label className="field">
            <span className="hint">{t('data.coords')}</span>
            <input type="text" autoComplete="off" spellCheck={false} value={p.coordsText} aria-invalid={p.coordsError} onChange={(e) => p.onCoordsText(e.target.value)} />
          </label>
          <button type="button" className="pix-btn" disabled={loading} onClick={p.onLoadLive}>
            {loading ? t('data.loading') : t('data.load')}
          </button>
        </details>
        <div className="actions">
          {!p.isDemo && (
            <button type="button" className="pix-btn" onClick={p.onBackToDemo}>
              {t('data.backToDemo')}
            </button>
          )}
        </div>
        {p.coordsError && (
          <p className="msg bad" role="alert">
            {t('data.badCoords')}
          </p>
        )}
        {p.liveStatus.state === 'done' && <p className="hint">{t(p.liveStatus.fromCache ? 'data.fromCache' : 'data.fetched')}</p>}
        {p.liveStatus.state === 'error' && <p className="msg bad">{t(`data.err.${p.liveStatus.code}`)}</p>}
      </div>
      <p className="footer">
        {t('app.contestLine')} · {t('app.phase')}
      </p>
    </>
  )
}
