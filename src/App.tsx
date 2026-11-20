import { useCallback, useEffect, useMemo, useState } from 'react'
import { APP_NAME } from './config/brand.ts'
import type { LatLon } from './geo/geo.ts'
import { stepsToMetres } from './geo/steps.ts'
import { useI18n, type Locale } from './i18n/index.ts'
import { DEMO_AREA } from './osm/demoArea.ts'
import { areaForWalk } from './osm/overpass.ts'
import { STEPS_PER_CHECKPOINT } from './routing/checkpoints.ts'
import { planRoute, type PlanResult, type RouteMode } from './routing/planner.ts'
import { MapView } from './ui/MapView.tsx'
import { clampSteps, loadSettings, parseCoords, saveSettings, type Settings } from './ui/settings.ts'
import { loadDemoWorld, useLiveLoader, type World } from './ui/useMapData.ts'

const STEP_PRESETS = [5000, 8000, 10_000, 12_000]
const WALK_KMH = 4.8

const fmt = (n: number, digits = 4) => n.toFixed(digits)

export default function App() {
  const { t, locale, setLocale } = useI18n()
  const [world, setWorld] = useState<World>()
  const [isDemo, setIsDemo] = useState(true)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [start, setStart] = useState<LatLon>(DEMO_AREA.defaultStart)
  const [end, setEnd] = useState<LatLon | undefined>(DEMO_AREA.defaultEnd)
  const [placing, setPlacing] = useState<'start' | 'end'>('start')
  const [result, setResult] = useState<PlanResult>()
  const [planning, setPlanning] = useState(false)
  const [seed, setSeed] = useState(0)
  const [coordsText, setCoordsText] = useState('39.4935, -0.3920')
  const [coordsError, setCoordsError] = useState(false)
  const live = useLiveLoader()

  useEffect(() => {
    let alive = true
    void loadDemoWorld().then((w) => alive && setWorld(w))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => saveSettings(settings), [settings])

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setResult(undefined)
  }

  const setMode = (mode: RouteMode) => {
    update({ mode })
    if (mode === 'loop') setPlacing('start')
  }

  const onTap = useCallback(
    (p: LatLon) => {
      if (settings.mode === 'oneway' && placing === 'end') setEnd(p)
      else setStart(p)
      setResult(undefined)
    },
    [placing, settings.mode],
  )

  const plan = (nextSeed = seed) => {
    if (!world) return
    setPlanning(true)
    setSeed(nextSeed)
    // Let the button repaint before the (fast but synchronous) search.
    setTimeout(() => {
      const res = planRoute(
        world.graph,
        { mode: settings.mode, start, end: settings.mode === 'oneway' ? end : undefined, targetSteps: settings.targetSteps, strideM: settings.strideM, seed: nextSeed },
        world.data.bbox,
      )
      setResult(res)
      setPlanning(false)
      // On phones the panel sits under the map: bring the map back into view.
      const map = document.querySelector('.map-wrap')
      if (map && map.getBoundingClientRect().bottom < 120) map.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  const loadLive = async () => {
    const coords = parseCoords(coordsText)
    setCoordsError(!coords)
    if (!coords) return
    const w = await live.load(areaForWalk(coords, stepsToMetres(settings.targetSteps, settings.strideM)))
    if (!w) return
    setWorld(w)
    setIsDemo(false)
    setStart(coords)
    setEnd(undefined)
    setPlacing(settings.mode === 'oneway' ? 'end' : 'start')
    setResult(undefined)
  }

  const backToDemo = async () => {
    setWorld(await loadDemoWorld())
    setIsDemo(true)
    resetPoints()
  }

  const resetPoints = () => {
    setStart(DEMO_AREA.defaultStart)
    setEnd(DEMO_AREA.defaultEnd)
    setResult(undefined)
  }

  const shown = result?.ok ? result.route : result?.closest
  const markers = useMemo(() => ({ start, end: settings.mode === 'oneway' ? end : undefined }), [start, end, settings.mode])
  const focus = useMemo<LatLon[]>(() => {
    if (shown) return shown.points
    return settings.mode === 'oneway' && end ? [start, end] : [start]
  }, [shown, start, end, settings.mode])
  const focusKey = shown ? `route:${shown.nodes.length}:${shown.distanceM}` : `pts:${settings.mode}:${end ? 'e' : ''}:${world ? 'w' : ''}`

  const km = (stepsToMetres(settings.targetSteps, settings.strideM) / 1000).toFixed(2)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">{APP_NAME}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <label className="lang">
          <span className="sr-only">{t('lang.switchTo')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('lang.switchTo')}>
            <option value="es">ES</option>
            <option value="en">EN</option>
          </select>
        </label>
      </header>

      <main className="layout">
        <section className="map-wrap">
          {world ? (
            <MapView grid={world.grid} route={shown} markers={markers} focus={focus} focusKey={focusKey} onTap={onTap} home={start} />
          ) : (
            <div className="map map-loading">{t('map.loading')}</div>
          )}
        </section>

        <aside className="panel">
          <div className="box">
            <h2 className="box-title">{t('mode.label')}</h2>
            <div className="segmented" role="radiogroup" aria-label={t('mode.label')}>
              {(['loop', 'oneway'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={settings.mode === m} className={`pix-btn ${settings.mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                  {t(m === 'loop' ? 'mode.loop' : 'mode.oneway')}
                </button>
              ))}
            </div>
            <p className="hint">{t(settings.mode === 'loop' ? 'mode.loopHint' : 'mode.onewayHint')}</p>

            {settings.mode === 'oneway' && (
              <>
                <h3 className="box-sub">{t('place.label')}</h3>
                <div className="segmented">
                  {(['start', 'end'] as const).map((p) => (
                    <button key={p} type="button" className={`pix-btn ${placing === p ? 'on' : ''}`} onClick={() => setPlacing(p)}>
                      {t(p === 'start' ? 'place.start' : 'place.end')}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="coords">
              ▶ {t('place.startAt', { lat: fmt(start.lat), lon: fmt(start.lon) })}
              {settings.mode === 'oneway' && (
                <>
                  <br />⚑ {end ? t('place.endAt', { lat: fmt(end.lat), lon: fmt(end.lon) }) : t('place.endMissing')}
                </>
              )}
            </p>
            {isDemo && (
              <button type="button" className="link-btn" onClick={resetPoints}>
                {t('place.reset')}
              </button>
            )}
          </div>

          <div className="box">
            <label className="field">
              <span className="box-title">{t('target.label')}</span>
              <span className="input-row">
                <input type="number" inputMode="numeric" min={500} max={40000} step={500} value={settings.targetSteps} onChange={(e) => update({ targetSteps: clampSteps(Number(e.target.value)) })} />
                <span className="unit">{t('target.unit')}</span>
              </span>
            </label>
            <div className="presets">
              {STEP_PRESETS.map((s) => (
                <button key={s} type="button" className={`chip ${settings.targetSteps === s ? 'on' : ''}`} onClick={() => update({ targetSteps: s })}>
                  {s / 1000}k
                </button>
              ))}
            </div>
            <label className="field">
              <span className="box-title">{t('stride.label')}</span>
              <span className="input-row">
                <input type="number" inputMode="decimal" min={0.4} max={1.2} step={0.01} value={settings.strideM} onChange={(e) => update({ strideM: Number(e.target.value) || 0.75 })} />
                <span className="unit">{t('stride.unit')}</span>
              </span>
            </label>
            <p className="hint">{t('stride.hint', { steps: settings.targetSteps.toLocaleString(locale), km })}</p>
            <div className="actions">
              <button type="button" className="pix-btn primary" disabled={!world || planning || (settings.mode === 'oneway' && !end)} onClick={() => plan(seed)}>
                {planning ? t('action.planning') : t('action.generate')}
              </button>
              {settings.mode === 'loop' && result && (
                <button type="button" className="pix-btn" disabled={planning} onClick={() => plan(seed + 1)}>
                  {t('action.reroll')}
                </button>
              )}
            </div>
          </div>

          <ResultBox result={result} onUseSteps={(steps) => update({ targetSteps: clampSteps(steps) })} />

          <div className="box">
            <h2 className="box-title">{t('data.label')}</h2>
            <p className="hint">{isDemo ? t('data.demo', { name: DEMO_AREA.name }) : t('data.live', { lat: fmt(start.lat), lon: fmt(start.lon) })}</p>
            <label className="field">
              <span className="hint">{t('data.coords')}</span>
              <input type="text" value={coordsText} onChange={(e) => setCoordsText(e.target.value)} />
            </label>
            <div className="actions">
              <button type="button" className="pix-btn" disabled={live.status.state === 'loading'} onClick={() => void loadLive()}>
                {live.status.state === 'loading' ? t('data.loading') : t('data.load')}
              </button>
              {!isDemo && (
                <button type="button" className="pix-btn" onClick={() => void backToDemo()}>
                  {t('data.backToDemo')}
                </button>
              )}
            </div>
            {coordsError && <p className="msg bad">{t('data.badCoords')}</p>}
            {live.status.state === 'done' && <p className="hint">{t(live.status.fromCache ? 'data.fromCache' : 'data.fetched')}</p>}
            {live.status.state === 'error' && <p className="msg bad">{t(`data.err.${live.status.code}`)}</p>}
          </div>
          <p className="footer">{t('app.contestLine')} · {t('app.phase')}</p>
        </aside>
      </main>
    </div>
  )
}

function ResultBox({ result, onUseSteps }: { result: PlanResult | undefined; onUseSteps: (steps: number) => void }) {
  const { t, locale } = useI18n()
  const route = result?.ok ? result.route : result?.closest
  const n = (v: number) => v.toLocaleString(locale)
  let message: { text: string; ok: boolean; suggest?: number } | undefined
  if (result?.ok) message = { text: t('result.ready', { n: result.route.checkpoints.length }), ok: true }
  else if (result) {
    switch (result.reason) {
      case 'tooShort':
        message = { text: t('error.tooShort', { min: n(result.minSteps ?? 0) }), ok: false, suggest: Math.ceil((result.minSteps ?? 0) / 100) * 100 }
        break
      case 'tooLong':
        message = { text: t('error.tooLong', { max: n(result.maxSteps ?? 0) }), ok: false, suggest: Math.floor((result.maxSteps ?? 0) / 100) * 100 }
        break
      case 'noMatch':
        message = { text: t('error.noMatch', { steps: n(result.closest?.steps ?? 0) }), ok: false }
        break
      default:
        message = { text: t(`error.${result.reason}`), ok: false }
    }
  }
  return (
    <div className="box result" aria-live="polite">
      <h2 className="box-title">{t('result.title')}</h2>
      {!result && <p className="hint">{t('result.empty')}</p>}
      {route && (
        <dl className="stats">
          <div>
            <dt>{t('result.distance')}</dt>
            <dd data-testid="distance">{(route.distanceM / 1000).toFixed(2)} km</dd>
          </div>
          <div>
            <dt>{t('result.steps')}</dt>
            <dd data-testid="steps">
              {n(route.steps)}{' '}
              <small>{t('result.vsTarget', { sign: route.error >= 0 ? '+' : '−', pct: Math.abs(route.error * 100).toFixed(1) })}</small>
            </dd>
          </div>
          <div>
            <dt>{t('result.checkpoints')}</dt>
            <dd>{t('result.checkpointsValue', { n: route.checkpoints.length, every: n(Math.round(route.steps / Math.max(1, route.checkpoints.length) / 10) * 10 || STEPS_PER_CHECKPOINT) })}</dd>
          </div>
          <div>
            <dt>{t('result.time')}</dt>
            <dd>{t('result.timeValue', { min: Math.round((route.distanceM / 1000 / WALK_KMH) * 60) })}</dd>
          </div>
        </dl>
      )}
      {message && (
        <p className={`msg ${message.ok ? 'good' : 'bad'}`} data-testid="feasibility">
          {message.text}
          {!message.ok && route && <> {t('error.preview')}</>}
        </p>
      )}
      {message?.suggest ? (
        <button type="button" className="pix-btn" onClick={() => onUseSteps(message.suggest!)}>
          {t('action.useSteps', { steps: n(message.suggest) })}
        </button>
      ) : null}
    </div>
  )
}
