import { useId, useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.ts'
import { normalizeName, searchStreets } from '../routing/safety.ts'

type Props = {
  safeRoute: boolean
  nightAware: boolean
  onChange: (patch: { safeRoute?: boolean; nightAware?: boolean }) => void
  /** Sunset today at the start point, already formatted (undefined in polar day/night). */
  sunset: string | undefined
  avoid: readonly string[]
  onAvoid: (name: string) => void
  onUnavoid: (name: string) => void
  /** Street names in the loaded area. */
  streets: readonly string[]
  picking: boolean
  onPick: (on: boolean) => void
  /** Feedback after a map tap. */
  pickNote?: { ok: boolean; name?: string }
}

/**
 * Compact safety settings: safe-route toggle, night weighting, and the list of
 * streets to avoid (search by name or tap on the map). Self-contained so it can
 * move into a pop-up menu later.
 */
export function SafetyBox(p: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const listId = useId()
  const hits = useMemo(() => searchStreets(p.streets, query).filter((n) => !p.avoid.some((a) => normalizeName(a) === normalizeName(n))), [p.streets, query, p.avoid])
  const here = useMemo(() => new Set(p.streets.map(normalizeName)), [p.streets])

  return (
    <div className="box safety" data-testid="safety">
      <h2 className="box-title">{t('safety.title')}</h2>
      <label className="check">
        <input type="checkbox" checked={p.safeRoute} onChange={(e) => p.onChange({ safeRoute: e.target.checked })} />
        <span>{t('safety.safe')}</span>
      </label>
      {p.safeRoute && <p className="hint">{t('safety.safeHint')}</p>}
      <label className="check">
        <input type="checkbox" checked={p.nightAware} disabled={!p.safeRoute} onChange={(e) => p.onChange({ nightAware: e.target.checked })} />
        <span>{t('safety.night')}</span>
      </label>
      {p.safeRoute && p.nightAware && p.sunset && <p className="hint">{t('safety.sunset', { time: p.sunset })}</p>}

      <h3 className="box-sub">{t('safety.avoid')}</h3>
      <label className="field">
        <span className="sr-only">{t('safety.search')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('safety.searchPlaceholder')}
          aria-label={t('safety.search')}
          aria-controls={listId}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {query.trim() && (
        <ul className="street-hits" id={listId}>
          {hits.length === 0 && <li className="hint">{t('safety.noMatch')}</li>}
          {hits.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  p.onAvoid(name)
                  setQuery('')
                }}
              >
                + {t('safety.add', { name })}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className={`pix-btn ${p.picking ? 'on' : ''}`} aria-pressed={p.picking} onClick={() => p.onPick(!p.picking)}>
          {p.picking ? t('safety.cancel') : t('safety.pick')}
        </button>
      </div>
      {p.picking && <p className="hint">{t('safety.picking')}</p>}
      {p.pickNote && <p className={p.pickNote.ok ? 'hint' : 'msg bad'}>{p.pickNote.ok ? t('safety.added', { name: p.pickNote.name ?? '' }) : t('safety.noStreet')}</p>}
      {p.avoid.length > 0 && (
        <>
          <ul className="avoid-list" aria-label={t('safety.avoid')}>
            {p.avoid.map((name) => (
              <li key={name} className="chip on">
                <span>{name}</span>
                {!here.has(normalizeName(name)) && <span className="hint"> · {t('safety.notHere')}</span>}
                <button type="button" className="chip-x" aria-label={t('safety.remove', { name })} onClick={() => p.onUnavoid(name)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">{t('safety.count', { n: p.avoid.length })}</p>
        </>
      )}
    </div>
  )
}
