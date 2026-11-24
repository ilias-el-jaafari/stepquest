import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { sunTimes } from '../geo/sun.ts'
import { useI18n } from '../i18n/index.ts'
import type { PlainKey } from '../i18n/en.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { useDismiss } from './useDismiss.ts'

const FAQ: readonly (readonly [PlainKey, PlainKey])[] = [
  ['info.q.route', 'info.a.route'],
  ['info.q.safe', 'info.a.safe'],
  ['info.q.night', 'info.a.night'],
  ['info.q.avoid', 'info.a.avoid'],
  ['info.q.privacy', 'info.a.privacy'],
]

/** Pixel "i" icon (original, drawn with rectangles). */
function InfoIcon() {
  return (
    <svg viewBox="0 0 8 10" width="12" height="15" aria-hidden="true" shapeRendering="crispEdges" className="info-icon">
      <rect x="3" y="0" width="2" height="2" fill="currentColor" />
      <rect x="2" y="3" width="3" height="1" fill="currentColor" />
      <rect x="3" y="4" width="2" height="5" fill="currentColor" />
      <rect x="2" y="9" width="4" height="1" fill="currentColor" />
    </svg>
  )
}

type Props = {
  /** Where sunrise/sunset are shown for (the start point). */
  place: LatLon
  /** Moment for "today" (fixed per visit). */
  now: number
}

/**
 * Info / FAQ: one header button that opens a small panel explaining how routes
 * are chosen, safety, night and the avoid list. Self-contained, so it can move
 * into the future pop-up menu.
 */
export function InfoMenu({ place, now }: Props) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const sun = useMemo(() => {
    const s = sunTimes(now, place)
    if (!s) return undefined
    const f = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    return { sunrise: f(s.sunrise), sunset: f(s.sunset) }
  }, [now, place, locale])

  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root, opener)

  return (
    <div className="sound-menu info-menu down" ref={root}>
      <button
        type="button"
        className="pix-btn sound-toggle"
        aria-expanded={open}
        ref={opener}
        aria-controls={open ? panelId : undefined}
        aria-label={t('info.title')}
        data-testid="info-button"
        onClick={() => setOpen((o) => !o)}
      >
        <InfoIcon />
        <span className="info-label">{t('info.button')}</span>
      </button>
      {open && (
        <div className="sound-panel info-panel" id={panelId} role="dialog" aria-label={t('info.title')} data-testid="info-panel">
          <div className="info-head">
            <h2 className="box-title">{t('info.title')}</h2>
            <button type="button" className="pix-btn round" aria-label={t('info.close')} title={t('info.close')} onClick={() => setOpen(false)}>
              <PixelIcon name="close" />
            </button>
          </div>
          <dl className="faq">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt>{t(q)}</dt>
                <dd>
                  {t(a)}
                  {q === 'info.q.night' && sun && <> {t('info.sunToday', sun)}</>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
