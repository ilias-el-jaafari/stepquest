import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { APP_NAME } from './config/brand.ts'
import { bboxContains, type BBox, type LatLon } from './geo/geo.ts'
import { MAX_STEPS, MAX_STRIDE_M, MIN_STEPS, MIN_STRIDE_M, stepsToMetres } from './geo/steps.ts'
import { useI18n, type Locale } from './i18n/index.ts'
import { DEMO_AREA } from './osm/demoArea.ts'
import { areaForWalk } from './osm/overpass.ts'
import { STEPS_PER_CHECKPOINT } from './routing/checkpoints.ts'
import { type PlanResult, type RouteMode } from './routing/planner.ts'
import { planWithSafety, type SafePlan } from './routing/safePlanner.ts'
import { nearestStreet, streetNames } from './routing/safety.ts'
import { isDark, sunTimes } from './geo/sun.ts'
import { addAvoid, loadAvoid, removeAvoid, saveAvoid } from './ui/avoidList.ts'
import { SafetyBox } from './ui/SafetyBox.tsx'
import { locateOnce, type LocationErrorCode } from './quest/geolocation.ts'
import { createQuest, type AreaRef } from './quest/quest.ts'
import { audioEngine } from './audio/engine.ts'
import { loadQuest } from './quest/storage.ts'
import { MapView } from './ui/MapView.tsx'
import { QuestScreen } from './ui/QuestScreen.tsx'
import { SoundMenu } from './ui/SoundMenu.tsx'
import { useQuestRunner } from './ui/useQuestRunner.ts'
import { commitSteps, commitStride, formatStride, liveSteps, liveStride, parseStepsText, parseStrideText, SLIDER_MAX, SLIDER_MIN, SLIDER_STEP, sliderValue, type Committed } from './ui/numberInput.ts'
import { clampSteps, loadSettings, parseCoords, saveSettings, type Settings } from './ui/settings.ts'
import { loadDemoWorld, useLiveLoader, type World } from './ui/useMapData.ts'

const STEP_PRESETS = [5000, 8000, 10_000, 12_000]
const SIM_SPEEDS = [1, 5, 20, 60, 120]

type LocateStatus =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'loadingArea' }
  | { state: 'ok'; accuracy: number; weak: boolean }
  | { state: 'error'; code: LocationErrorCode; accuracy?: number }
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
  const [safePlan, setSafePlan] = useState<SafePlan>()
  const [usingNormal, setUsingNormal] = useState(false)
  const [avoid, setAvoid] = useState<string[]>(() => loadAvoid())
  const [pickingAvoid, setPickingAvoid] = useState(false)
  const [pickNote, setPickNote] = useState<{ ok: boolean; name?: string }>()
  const [planning, setPlanning] = useState(false)
  const [seed, setSeed] = useState(0)
  const [coordsText, setCoordsText] = useState('39.4935, -0.3920')
  const [coordsError, setCoordsError] = useState(false)
  const [liveBox, setLiveBox] = useState<BBox>()
  const [locate, setLocate] = useState<LocateStatus>({ state: 'idle' })
  const [simulate, setSimulate] = useState(false)
  const [simSpeed, setSimSpeed] = useState(20)
  const [simNoise, setSimNoise] = useState(true)
  const [resumed, setResumed] = useState(false)
  // Raw text of the number fields: typed freely, validated on blur, Enter or Plan.
  const [stepsText, setStepsText] = useState(() => String(settings.targetSteps))
  const [strideText, setStrideText] = useState(() => formatStride(settings.strideM))
  const [stepsNote, setStepsNote] = useState<Committed>()
  const [strideNote, setStrideNote] = useState<Committed>()
  const live = useLiveLoader()
  const runner = useQuestRunner()
  const liveLoad = live.load
  const beginQuest = runner.begin
  const booted = useRef(false)

  // On start-up: resume a saved quest (bringing back its map), else load the demo area.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const saved = loadQuest(Date.now())
    void (async () => {
      let w: World | undefined
      if (saved?.area.kind === 'live') {
        w = await liveLoad(saved.area.bbox)
        if (w) {
          setIsDemo(false)
          setLiveBox(saved.area.bbox)
        }
      }
      w ??= await loadDemoWorld()
      setWorld(w)
      if (saved && (saved.area.kind === 'demo' || !isDemoWorld(w))) {
        setResumed(true)
        beginQuest(saved, true)
      }
    })()
  }, [liveLoad, beginQuest])

  useEffect(() => saveSettings(settings), [settings])

  // Planning screen: calm music at a steady tempo, starting on the first tap (autoplay rules).
  const onPlanning = !runner.quest
  useEffect(() => {
    if (!onPlanning) return
    const audio = audioEngine()
    audio.armUnlock()
    audio.playMenuMusic()
  }, [onPlanning])

  const clearResult = () => {
    setResult(undefined)
    setSafePlan(undefined)
    setUsingNormal(false)
  }

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    clearResult()
  }

  const changeAvoid = (next: string[]) => {
    setAvoid(next)
    saveAvoid(next)
    clearResult()
  }

  const streets = useMemo(() => (world ? streetNames(world.data) : []), [world])

  const setSteps = (value: number) => {
    setStepsText(String(value))
    setStepsNote(undefined)
    if (value !== settings.targetSteps) update({ targetSteps: value })
  }

  const typeSteps = (text: string) => {
    setStepsText(text)
    setStepsNote(undefined)
    const v = liveSteps(text)
    if (v !== undefined && v !== settings.targetSteps) update({ targetSteps: v })
  }

  const typeStride = (text: string) => {
    setStrideText(text)
    setStrideNote(undefined)
    const v = liveStride(text)
    if (v !== undefined && v !== settings.strideM) update({ strideM: v })
  }

  /** Validate and clamp the typed step goal; returns the value to use. */
  const commitStepsField = (): number => {
    const c = commitSteps(stepsText, settings.targetSteps)
    setStepsText(String(c.value))
    setStepsNote(c.note ? c : undefined)
    if (c.value !== settings.targetSteps) update({ targetSteps: c.value })
    return c.value
  }

  const commitStrideField = (): number => {
    const c = commitStride(strideText, settings.strideM)
    setStrideText(formatStride(c.value))
    setStrideNote(c.note ? c : undefined)
    if (c.value !== settings.strideM) update({ strideM: c.value })
    return c.value
  }

  const onEnter = (commitField: () => number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitField()
    }
  }

  const setMode = (mode: RouteMode) => {
    update({ mode })
    if (mode === 'loop') setPlacing('start')
  }

  const onTap = useCallback(
    (p: LatLon) => {
      if (pickingAvoid) {
        const name = world ? nearestStreet(world.data, p) : undefined
        setPickNote(name ? { ok: true, name } : { ok: false })
        if (name) {
          setPickingAvoid(false)
          setAvoid((list) => {
            const next = addAvoid(list, name)
            saveAvoid(next)
            return next
          })
          setResult(undefined)
          setSafePlan(undefined)
          setUsingNormal(false)
        }
        return
      }
      if (settings.mode === 'oneway' && placing === 'end') setEnd(p)
      else setStart(p)
      setResult(undefined)
      setSafePlan(undefined)
      setUsingNormal(false)
    },
    [placing, settings.mode, pickingAvoid, world],
  )

  const plan = (nextSeed = seed) => {
    if (!world) return
    const targetSteps = commitStepsField()
    const strideM = commitStrideField()
    setPlanning(true)
    setSeed(nextSeed)
    // Let the button repaint before the (fast but synchronous) search.
    setTimeout(() => {
      // Dark at the start or by the (estimated) end of the walk: lighting counts more.
      const now = Date.now()
      const walkMs = (stepsToMetres(targetSteps, strideM) / 1000 / WALK_KMH) * 3_600_000
      const night = settings.safeRoute && settings.nightAware && (isDark(now, start) || isDark(now + walkMs, start))
      const sp = planWithSafety(
        world.graph,
        world.safety,
        { mode: settings.mode, start, end: settings.mode === 'oneway' ? end : undefined, targetSteps, strideM, seed: nextSeed },
        world.data.bbox,
        { safe: settings.safeRoute, night, avoid },
      )
      setSafePlan(sp)
      setUsingNormal(false)
      setResult(sp.result)
      setPlanning(false)
      // On phones the panel sits under the map: bring the map back into view.
      const map = document.querySelector('.map-wrap')
      if (map && map.getBoundingClientRect().bottom < 120) map.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  /** Load the live OSM area around a point and make it the start. */
  const loadLiveAround = async (coords: LatLon): Promise<boolean> => {
    const box = areaForWalk(coords, stepsToMetres(settings.targetSteps, settings.strideM))
    const w = await live.load(box)
    if (!w) return false
    setWorld(w)
    setIsDemo(false)
    setLiveBox(box)
    setStart(coords)
    setEnd(undefined)
    setPlacing(settings.mode === 'oneway' ? 'end' : 'start')
    clearResult()
    return true
  }

  const loadLive = async () => {
    const coords = parseCoords(coordsText)
    setCoordsError(!coords)
    if (!coords) return
    await loadLiveAround(coords)
  }

  const locateMe = async () => {
    setLocate({ state: 'locating' })
    const res = await locateOnce()
    if (!res.ok) {
      setLocate({ state: 'error', code: res.code, accuracy: res.fix?.accuracy })
      return
    }
    const p = { lat: res.fix.lat, lon: res.fix.lon }
    setCoordsText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)
    if (world && bboxContains(world.data.bbox, p)) {
      setStart(p)
      setPlacing(settings.mode === 'oneway' ? 'end' : 'start')
      clearResult()
    } else {
      setLocate({ state: 'loadingArea' })
      const ok = await loadLiveAround(p)
      if (!ok) {
        setLocate({ state: 'idle' })
        return
      }
    }
    setLocate({ state: 'ok', accuracy: res.fix.accuracy, weak: res.weak })
  }

  const startQuest = () => {
    if (!result?.ok) return
    const area: AreaRef = isDemo || !liveBox ? { kind: 'demo' } : { kind: 'live', bbox: liveBox }
    const r = result.route
    setResumed(false)
    runner.begin(
      createQuest(
        { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints },
        { strideM: settings.strideM, area, simulated: simulate, now: Date.now(), sim: simulate ? { timeScale: simSpeed, noiseM: simNoise ? 5 : 0 } : undefined },
      ),
    )
  }

  const backToDemo = async () => {
    setWorld(await loadDemoWorld())
    setIsDemo(true)
    setLiveBox(undefined)
    resetPoints()
  }

  const resetPoints = () => {
    setStart(DEMO_AREA.defaultStart)
    setEnd(DEMO_AREA.defaultEnd)
    clearResult()
  }

  const [today] = useState(() => Date.now())
  const sunsetText = useMemo(() => {
    const times = sunTimes(today, start)
    return times ? new Date(times.sunset).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : undefined
  }, [start, locale, today])

  const shown = result?.ok ? result.route : result?.closest
  const markers = useMemo(() => ({ start, end: settings.mode === 'oneway' ? end : undefined }), [start, end, settings.mode])
  const focus = useMemo<LatLon[]>(() => {
    if (shown) return shown.points
    return settings.mode === 'oneway' && end ? [start, end] : [start]
  }, [shown, start, end, settings.mode])
  const focusKey = shown ? `route:${shown.nodes.length}:${shown.distanceM}` : `pts:${settings.mode}:${end ? 'e' : ''}:${world ? 'w' : ''}`

  const stepsTyped = parseStepsText(stepsText)
  const stepsOutOfRange = stepsTyped.kind === 'number' && (stepsTyped.value < MIN_STEPS || stepsTyped.value > MAX_STEPS)
  const strideTyped = parseStrideText(strideText)
  const strideOutOfRange = strideTyped.kind === 'number' && (strideTyped.value < MIN_STRIDE_M || strideTyped.value > MAX_STRIDE_M)
  const stepRange = { min: MIN_STEPS.toLocaleString(locale), max: MAX_STEPS.toLocaleString(locale) }
  const strideRange = { min: MIN_STRIDE_M.toLocaleString(locale), max: MAX_STRIDE_M.toLocaleString(locale) }
  const km = (stepsToMetres(settings.targetSteps, settings.strideM) / 1000).toFixed(2)

  if (runner.quest && world) {
    return (
      <QuestScreen
        key={runner.quest.id}
        grid={world.grid}
        quest={runner.quest}
        pickup={runner.pickup}
        error={runner.error}
        wakeActive={runner.wakeActive}
        resumed={resumed}
        onEnd={runner.end}
        onUseSim={() => runner.switchToSimulation(simSpeed)}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">{APP_NAME}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="topbar-tools">
          <SoundMenu placement="down" />
          <label className="lang">
            <span className="sr-only">{t('lang.switchTo')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('lang.switchTo')}>
              <option value="es">ES</option>
              <option value="en">EN</option>
            </select>
          </label>
        </div>
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
            <div className="actions">
              <button type="button" className="pix-btn" disabled={locate.state === 'locating' || locate.state === 'loadingArea'} onClick={() => void locateMe()}>
                ◉ {locate.state === 'locating' ? t('loc.locating') : t('loc.use')}
              </button>
            </div>
            <LocateMessage status={locate} />
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
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  name="steps"
                  aria-invalid={stepsOutOfRange || stepsTyped.kind === 'invalid'}
                  aria-describedby="steps-note"
                  value={stepsText}
                  onChange={(e) => typeSteps(e.target.value)}
                  onBlur={commitStepsField}
                  onKeyDown={onEnter(commitStepsField)}
                />
                <span className="unit">{t('target.unit')}</span>
              </span>
            </label>
            <input
              type="range"
              className="pix-range"
              aria-label={t('target.slider')}
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={SLIDER_STEP}
              value={sliderValue(liveSteps(stepsText) ?? settings.targetSteps)}
              onChange={(e) => setSteps(Number(e.target.value))}
            />
            <FieldNote id="steps-note" note={stepsNote} outOfRange={stepsOutOfRange} invalid={stepsTyped.kind === 'invalid'} prefix="target" range={stepRange} format={(v) => v.toLocaleString(locale)} />
            <div className="presets">
              {STEP_PRESETS.map((s) => (
                <button key={s} type="button" className={`chip ${settings.targetSteps === s ? 'on' : ''}`} onClick={() => setSteps(s)}>
                  {s / 1000}k
                </button>
              ))}
            </div>
            <label className="field">
              <span className="box-title">{t('stride.label')}</span>
              <span className="input-row">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  name="stride"
                  aria-invalid={strideOutOfRange || strideTyped.kind === 'invalid'}
                  aria-describedby="stride-note"
                  value={strideText}
                  onChange={(e) => typeStride(e.target.value)}
                  onBlur={commitStrideField}
                  onKeyDown={onEnter(commitStrideField)}
                />
                <span className="unit">{t('stride.unit')}</span>
              </span>
            </label>
            <FieldNote id="stride-note" note={strideNote} outOfRange={strideOutOfRange} invalid={strideTyped.kind === 'invalid'} prefix="stride" range={strideRange} format={(v) => v.toLocaleString(locale)} />
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

          <SafetyBox
            safeRoute={settings.safeRoute}
            nightAware={settings.nightAware}
            onChange={update}
            sunset={sunsetText}
            avoid={avoid}
            onAvoid={(name) => changeAvoid(addAvoid(avoid, name))}
            onUnavoid={(name) => changeAvoid(removeAvoid(avoid, name))}
            streets={streets}
            picking={pickingAvoid}
            onPick={(on) => {
              setPickingAvoid(on)
              setPickNote(undefined)
            }}
            pickNote={pickNote}
          />
          <ResultBox result={result} onUseSteps={(steps) => setSteps(clampSteps(steps))} />
          {safePlan && result && (
            <SafetyNotice
              plan={safePlan}
              usingNormal={usingNormal}
              onUseNormal={() => {
                if (!safePlan.normal) return
                setUsingNormal(true)
                setResult(safePlan.normal)
              }}
            />
          )}

          {result?.ok && (
            <div className="box quest-start">
              <button type="button" className="pix-btn primary big" onClick={startQuest}>
                ▶ {t('quest.start')}
              </button>
              <label className="check">
                <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
                <span>{t('quest.simulate')}</span>
              </label>
              {simulate && (
                <div className="sim-options">
                  <p className="hint">{t('quest.simulateHint')}</p>
                  <label className="field inline">
                    <span className="hint">{t('quest.simSpeed')}</span>
                    <select value={simSpeed} onChange={(e) => setSimSpeed(Number(e.target.value))} aria-label={t('quest.simSpeed')}>
                      {SIM_SPEEDS.map((x) => (
                        <option key={x} value={x}>
                          {t('quest.simSpeedValue', { x })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={simNoise} onChange={(e) => setSimNoise(e.target.checked)} />
                    <span>{t('quest.simNoise')}</span>
                  </label>
                </div>
              )}
            </div>
          )}

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

function isDemoWorld(w: World): boolean {
  return w.data.source === 'fixture'
}

function LocateMessage({ status }: { status: LocateStatus }) {
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

/** Inline hint under a number field: live range warning while typing, or what blur/Enter/Plan changed. */
function FieldNote(props: {
  id: string
  note?: Committed
  outOfRange: boolean
  invalid: boolean
  prefix: 'target' | 'stride'
  range: { min: string; max: string }
  format: (v: number) => string
}) {
  const { t } = useI18n()
  const { note, prefix, range } = props
  let text: string | undefined
  if (note?.note === 'invalid') text = t(`${prefix}.invalid`, { value: props.format(note.value) })
  else if (note) text = t(`${prefix}.adjusted`, { value: props.format(note.value), ...range })
  else if (props.outOfRange || props.invalid) text = t(`${prefix}.range`, range)
  return (
    <p id={props.id} className={`field-note ${note ? 'warn' : ''}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}

function SafetyNotice({ plan, usingNormal, onUseNormal }: { plan: SafePlan; usingNormal: boolean; onUseNormal: () => void }) {
  const { t } = useI18n()
  const pct = (v: number) => Math.round(v * 100)
  const lines: { text: string; ok: boolean }[] = []
  if (usingNormal) lines.push({ text: t('safety.usingNormal'), ok: false })
  else {
    if (plan.notice === 'safeInfeasible') lines.push({ text: t('safety.infeasible'), ok: false })
    if (plan.notice === 'avoidIgnored' && plan.avoidedUsed?.length) {
      lines.push({ text: t('safety.avoidIgnored', { names: plan.avoidedUsed.join(', '), n: plan.avoidedUsed.length }), ok: false })
    }
    if (plan.safety) lines.push({ text: t('safety.summary', { pref: pct(plan.safety.preferred), lit: pct(plan.safety.lit) }), ok: true })
    if (plan.night) lines.push({ text: t('safety.dark'), ok: true })
  }
  if (lines.length === 0) return null
  return (
    <div className="box safety-notice" aria-live="polite" data-testid="safety-notice">
      {lines.map((l) => (
        <p key={l.text} className={l.ok ? 'hint' : 'msg bad'}>
          {l.text}
        </p>
      ))}
      {plan.normal && !usingNormal && (
        <div className="actions">
          <button type="button" className="pix-btn" onClick={onUseNormal}>
            {t('safety.useNormal')}
          </button>
        </div>
      )}
    </div>
  )
}
