import { useId, useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.ts'
import { normalizeName, searchStreets } from '../routing/safety.ts'

type Props = {
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

/** Small hazard-tape swatch matching how avoided streets are drawn on the map. */
function HazardSwatch() {
  return (
    <svg className="hazard-swatch" viewBox="0 0 16 6" width="32" height="12" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="0" y="0" width="16" height="6" fill="#1b1a2e" />
      {[0, 6, 12].map((x) => (
        <rect key={x} x={x + 1} y="1" width="3" height="4" fill="#ffb000" />
      ))}
    </svg>
  )
}

/**
 * The user's list of streets to avoid: search loaded street names or tap the
 * map. Compact and self-contained so it can move into a pop-up menu later.
 */
export function AvoidStreetsBox(p: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const listId = useId()
  const hits = useMemo(() => searchStreets(p.streets, query).filter((n) => !p.avoid.some((a) => normalizeName(a) === normalizeName(n))), [p.streets, query, p.avoid])
  const here = useMemo(() => new Set(p.streets.map(normalizeName)), [p.streets])

  return (
    <div className="box avoid-box" data-testid="avoid-streets">
      <h2 className="box-title">{t('safety.avoid')}</h2>
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
          <p className="hint legend">
            <HazardSwatch /> {t('safety.count', { n: p.avoid.length })} {t('safety.legend')}
          </p>
        </>
      )}
    </div>
  )
}
