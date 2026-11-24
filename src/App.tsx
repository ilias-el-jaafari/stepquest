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
import { avoidedPolylines, nearestStreet, streetNames } from './routing/safety.ts'
import { isDark } from './geo/sun.ts'
import { addAvoid, loadAvoid, removeAvoid, saveAvoid } from './ui/avoidList.ts'
import { AvoidStreetsBox } from './ui/AvoidStreetsBox.tsx'
import { InfoMenu } from './ui/InfoMenu.tsx'
import { locateOnce, type LocationErrorCode } from './quest/geolocation.ts'
import { createQuest, type AreaRef, type QuestState } from './quest/quest.ts'
import { rerouteQuest } from './quest/reroute.ts'
import { audioEngine } from './audio/engine.ts'
import { loadQuest } from './quest/storage.ts'
import { MapView } from './ui/MapView.tsx'
import { QuestScreen } from './ui/QuestScreen.tsx'
import { SoundControls } from './ui/SoundMenu.tsx'
import { PixelSvg } from './ui/PixelIcons.tsx'
import { TabBar } from './ui/TabBar.tsx'
import { panelId, tabId, type Tab } from './ui/tabs.ts'
import { walkerFor } from './hero/look.ts'
import { useLook } from './hero/useLook.ts'
import { HeroEditor } from './ui/HeroEditor.tsx'
import { StepMeter } from './ui/StepMeter.tsx'
import { deviceVibrate, installPressFeedback } from './ui/pressFeedback.ts'
import { addStepsToday, stepsToday } from './quest/dailySteps.ts'
import { questStats } from './quest/quest.ts'
import { useQuestRunner } from './ui/useQuestRunner.ts'
import { commitSteps, commitStride, formatStride, liveSteps, liveStride, parseStepsText, parseStrideText, SLIDER_MAX, SLIDER_MIN, SLIDER_STEP, sliderValue, type Committed } from './ui/numberInput.ts'
import { clampSteps, loadSettings, parseCoords, saveSettings, type Settings } from './ui/settings.ts'
import { AUTO_LOAD_SETTLE_MS, shouldAutoLoad } from './ui/autoLoad.ts'
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
  const walker = walkerFor(useLook())
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
  const [tab, setTab] = useState<Tab>('map')
  /** Map centre after a pan or zoom, to offer loading an area that is not loaded yet. */
  const [viewCentre, setViewCentre] = useState<LatLon>()
  /** Location permission not granted yet: offer planning around the walker's position. */
  const [askHere, setAskHere] = useState(false)
  const locateRef = useRef<(w?: World) => Promise<void>>(async () => {})
  /** On phones the planner folds down to the route line and the start button once a route is ready. */
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [todaySteps, setTodaySteps] = useState(() => stepsToday(Date.now()))
  // Raw text of the number fields: typed freely, validated on blur, Enter or Plan.
  const [stepsText, setStepsText] = useState(() => String(settings.targetSteps))
  const [strideText, setStrideText] = useState(() => formatStride(settings.strideM))
  const [stepsNote, setStepsNote] = useState<Committed>()
  const [strideNote, setStrideNote] = useState<Committed>()
  const live = useLiveLoader()
  const reroute = useCallback(
    (q: QuestState) => (world ? rerouteQuest(q, { graph: world.graph, ctx: world.safety, data: world.data, bbox: world.data.bbox }, { avoid, now: Date.now() }) : undefined),
    [world, avoid],
  )
  const runner = useQuestRunner(reroute)
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
        return
      }
      // No quest to resume: load the map around the walker when location is already allowed,
      // otherwise offer it (the browser asks for permission on that tap).
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => undefined)
      if (permission?.state === 'granted') void locateRef.current(w)
      else if (permission?.state !== 'denied') setAskHere(true)
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

  // Every press clicks on the effects channel (volume and mute apply) and buzzes a little on Android.
  useEffect(
    () =>
      installPressFeedback(document, {
        playClick: () => audioEngine().playSfx('click'),
        vibrate: deviceVibrate(),
        userAgent: navigator.userAgent,
      }),
    [],
  )

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
          setTab('bag')
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
      // Safe routing is always on. From sunset to sunrise (at the start or by the
      // estimated end of the walk) lighting counts more, automatically.
      const now = Date.now()
      const walkMs = (stepsToMetres(targetSteps, strideM) / 1000 / WALK_KMH) * 3_600_000
      const night = isDark(now, start) || isDark(now + walkMs, start)
      const sp = planWithSafety(
        world.graph,
        world.safety,
        { mode: settings.mode, start, end: settings.mode === 'oneway' ? end : undefined, targetSteps, strideM, seed: nextSeed },
        world.data.bbox,
        { safe: true, night, avoid },
      )
      setSafePlan(sp)
      setUsingNormal(false)
      setResult(sp.result)
      setPlannerOpen(false)
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
    setAskHere(false)
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

  /** `loaded` is the world just loaded at start-up (state is not updated yet then). */
  const locateMe = async (loaded?: World) => {
    const current = loaded ?? world
    setAskHere(false)
    setLocate({ state: 'locating' })
    const res = await locateOnce()
    if (!res.ok) {
      setLocate({ state: 'error', code: res.code, accuracy: res.fix?.accuracy })
      return
    }
    const p = { lat: res.fix.lat, lon: res.fix.lon }
    setCoordsText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)
    if (current && bboxContains(current.data.bbox, p)) {
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

  useEffect(() => {
    locateRef.current = locateMe
  })

  const loadView = async () => {
    if (!viewCentre) return
    if (await loadLiveAround(viewCentre)) setViewCentre(undefined)
  }
  const plannerFolded = !!result?.ok && !plannerOpen
  const outsideView = !!world && !!viewCentre && !bboxContains(world.data.bbox, viewCentre)
  // Resting the map outside the loaded area loads it, when no route would be lost. One request at a
  // time, after the map has settled; a failed spot is not retried until the view moves away (the
  // Overpass client also waits at least 10 s between requests).
  const failedAt = useRef<LatLon>(undefined)
  const hasPlan = !!result?.ok || !!runner.quest
  const bbox = world?.data.bbox
  const busy = live.status.state === 'loading' || locate.state === 'locating' || locate.state === 'loadingArea'
  useEffect(() => {
    if (!bbox || !viewCentre) return
    if (!shouldAutoLoad({ bbox, centre: viewCentre, busy, hasPlan, failedAt: failedAt.current })) return
    const timer = setTimeout(() => {
      void loadLiveAround(viewCentre).then((ok) => {
        if (ok) setViewCentre(undefined)
        else failedAt.current = viewCentre
      })
    }, AUTO_LOAD_SETTLE_MS)
    return () => clearTimeout(timer)
    // loadLiveAround is recreated every render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, viewCentre, busy, hasPlan])
  const loadingMb = live.status.state === 'loading' ? (live.status.bytes / 1e6).toFixed(1) : undefined

  // Leaving a quest: real (not simulated) steps add to today's total.
  const endQuest = () => {
    const q = runner.quest
    const now = Date.now()
    if (q && !q.simulated) setTodaySteps(addStepsToday(questStats(q, now).steps, now))
    runner.end()
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
  const avoidedLines = useMemo(() => (world ? avoidedPolylines(world.data, avoid) : []), [world, avoid])

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
        onEnd={endQuest}
        onUseSim={() => runner.switchToSimulation(simSpeed)}
      />
    )
  }

  const hidden = (name: Tab) => tab !== name
  const todayPct = Math.min(100, Math.round((todaySteps / Math.max(1, settings.targetSteps)) * 100))
  const shownRoute = result?.ok ? result.route : result?.closest

  return (
    <div className={`app tab-${tab}`}>
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">{APP_NAME}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="status-row">
          <span className="avatar" role="img" aria-label={t('header.avatar')}>
            <PixelSvg art={walker.down[0]!} size={30} />
          </span>
          <span className="steps-pill" data-testid="steps-today">
            <span className="steps-pill-label">{t('header.stepsToday')}:</span> <strong>{todaySteps.toLocaleString(locale)}</strong>
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="map-wrap">
          {world ? (
            <MapView
              grid={world.grid}
              route={shown}
              markers={markers}
              focus={focus}
              focusKey={focusKey}
              onTap={onTap}
              home={start}
              avoided={avoidedLines}
              onLocate={() => void locateMe()}
              locating={locate.state === 'locating' || locate.state === 'loadingArea'}
              onView={setViewCentre}
            />
          ) : (
            <div className="map map-loading">{t('map.loading')}</div>
          )}
          {(pickingAvoid || pickNote?.ok === false) && (
            <div className="map-banner" role="status">
              <span>{pickingAvoid ? t('safety.picking') : t('safety.noStreet')}</span>
              <button
                type="button"
                className="pix-btn small-text"
                onClick={() => {
                  setPickingAvoid(false)
                  setPickNote(undefined)
                  setTab('bag')
                }}
              >
                {t('safety.cancel')}
              </button>
            </div>
          )}
          {!pickingAvoid && pickNote?.ok !== false && (loadingMb !== undefined || outsideView || askHere) && (
            <div className="map-banner area-toast" role="status" data-testid="area-toast">
              {loadingMb !== undefined ? (
                <span>{t('area.loading', { mb: loadingMb })}</span>
              ) : outsideView ? (
                <>
                  <span>{t('area.outside')}</span>
                  {live.status.state === 'error' && <span className="area-error">{t(`data.err.${live.status.code}`)}</span>}
                  <button type="button" className="pix-btn small-text" onClick={() => void loadView()} data-testid="load-area">
                    {t('area.load')}
                  </button>
                </>
              ) : (
                <>
                  <span>{t('area.askHere')}</span>
                  <button type="button" className="pix-btn small-text" onClick={() => void locateMe()}>
                    {t('loc.use')}
                  </button>
                  <button type="button" className="pix-btn small-text" onClick={() => setAskHere(false)} aria-label={t('info.close')}>
                    ×
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* Map tab: the planner, framed above the tab bar. */}
        <section className="sheet planner" id={panelId('map')} role="tabpanel" aria-labelledby={tabId('map')} hidden={hidden('map')}>
          <div className={`box planner-box ${plannerFolded ? 'folded' : ''}`} data-testid="planner">
            {result?.ok && (
              <button
                type="button"
                className="pix-btn small-text planner-toggle"
                aria-expanded={!plannerFolded}
                aria-controls="planner-edit"
                onClick={() => setPlannerOpen(!plannerOpen)}
                data-testid="planner-toggle"
              >
                <span className={`chev ${plannerFolded ? 'up' : 'down'}`} aria-hidden="true" /> {plannerFolded ? t('planner.edit') : t('planner.hide')}
              </button>
            )}
            <div className="planner-edit" id="planner-edit">
              <div className="planner-row">
                <div className="segmented small" role="radiogroup" aria-label={t('mode.label')}>
                  {(['loop', 'oneway'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={settings.mode === m} className={`pix-btn ${settings.mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                      {t(m === 'loop' ? 'mode.loop' : 'mode.oneway')}
                    </button>
                  ))}
                </div>
                {settings.mode === 'oneway' && (
                  <div className="segmented small" aria-label={t('place.label')}>
                    {(['start', 'end'] as const).map((p) => (
                      <button key={p} type="button" className={`pix-btn ${placing === p ? 'on' : ''}`} onClick={() => setPlacing(p)}>
                        {t(p === 'start' ? 'place.start' : 'place.end')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
            </div>
            <LocateMessage status={locate} />
            {shownRoute && (
              <p className={`route-line ${result?.ok ? 'ok' : 'bad'}`} data-testid="route-line">
                {t('result.short', { km: (shownRoute.distanceM / 1000).toFixed(2), steps: shownRoute.steps.toLocaleString(locale), n: shownRoute.steps })}
                {!result?.ok && <> · {t('result.title')} ▸</>}
                {result?.ok && simulate && <> · {t('bag.demo')}</>}
              </p>
            )}
            {result?.ok && (
              <button type="button" className="pix-btn primary big start-btn" onClick={startQuest}>
                ▶ {t('quest.start')}
              </button>
            )}
            <div className="actions">
              <button type="button" className={`pix-btn ${result?.ok ? 'small-text' : 'primary big'}`} disabled={!world || planning || (settings.mode === 'oneway' && !end)} onClick={() => plan(seed)}>
                {planning ? t('action.planning') : t('action.generate')}
              </button>
              {settings.mode === 'loop' && result && (
                <button type="button" className={`pix-btn ${result?.ok ? 'small-text' : ''}`} disabled={planning} onClick={() => plan(seed + 1)}>
                  {t('action.reroll')}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Bag: the quest log and the route kit (start point, streets to avoid). */}
        <section className="sheet" id={panelId('bag')} role="tabpanel" aria-labelledby={tabId('bag')} hidden={hidden('bag')}>
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
          <div className="box quest-start">
            <h2 className="box-title">{t('bag.demo')}</h2>
            <p className="hint">{t('quest.simulateHint')}</p>
            <label className="check">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
              <span>{t('quest.simulate')}</span>
            </label>
            {simulate && (
              <div className="sim-options">
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
          <div className="box">
            <h2 className="box-title">{t('bag.start')}</h2>
            <p className="hint">{t(settings.mode === 'loop' ? 'mode.loopHint' : 'mode.onewayHint')}</p>
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
          <AvoidStreetsBox
            avoid={avoid}
            onAvoid={(name) => changeAvoid(addAvoid(avoid, name))}
            onUnavoid={(name) => changeAvoid(removeAvoid(avoid, name))}
            streets={streets}
            picking={pickingAvoid}
            onPick={(on) => {
              setPickingAvoid(on)
              setPickNote(undefined)
              // Picking needs the map in view.
              if (on) setTab('map')
            }}
            pickNote={pickNote}
          />
        </section>

        {/* Hero: the walker, today's steps and the stride. */}
        <section className="sheet" id={panelId('hero')} role="tabpanel" aria-labelledby={tabId('hero')} hidden={hidden('hero')}>
          <div className="box hero-box">
            <div className="hero-head">
              <span className="avatar big" aria-hidden="true">
                <PixelSvg art={walker.down[0]!} size={64} />
              </span>
              <div>
                <h2 className="box-title">{t('hero.title')}</h2>
                <p className="hero-today">
                  {t('hero.today')}: <strong>{todaySteps.toLocaleString(locale)}</strong>
                </p>
                <p className="hint">{t('hero.goal', { goal: settings.targetSteps.toLocaleString(locale) })}</p>
              </div>
            </div>
            <StepMeter pct={todayPct} label={t('hero.progress', { pct: todayPct })} />
            <p className="hint">{t('hero.progress', { pct: todayPct })}</p>
            <p className="hint">{t('hero.note')}</p>
          </div>
          <HeroEditor />
          <div className="box">
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
            <p className="hint" data-testid="km-hint">{t('stride.hint', { steps: settings.targetSteps.toLocaleString(locale), km })}</p>
          </div>
        </section>

        {/* Settings: sound, language, map data and help. */}
        <section className="sheet" id={panelId('settings')} role="tabpanel" aria-labelledby={tabId('settings')} hidden={hidden('settings')}>
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
            <InfoMenu place={start} now={today} />
          </div>
          <div className="box">
            <h2 className="box-title">{t('data.label')}</h2>
            <p className="hint">{isDemo ? t('data.demo', { name: DEMO_AREA.name }) : t('data.live', { lat: fmt(start.lat), lon: fmt(start.lon) })}</p>
            <p className="hint">{t('data.howTo')}</p>
            <details className="advanced">
              <summary>{t('data.advanced')}</summary>
              <label className="field">
                <span className="hint">{t('data.coords')}</span>
                <input type="text" value={coordsText} onChange={(e) => setCoordsText(e.target.value)} />
              </label>
              <button type="button" className="pix-btn" disabled={live.status.state === 'loading'} onClick={() => void loadLive()}>
                {live.status.state === 'loading' ? t('data.loading') : t('data.load')}
              </button>
            </details>
            <div className="actions">
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
        </section>
      </main>

      <TabBar tab={tab} onTab={setTab} />
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
  const lines: { text: string; ok: boolean }[] = []
  if (usingNormal) lines.push({ text: t('safety.usingNormal'), ok: false })
  else {
    if (plan.notice === 'safeInfeasible') lines.push({ text: t('safety.infeasible'), ok: false })
    if (plan.notice === 'avoidIgnored' && plan.avoidedUsed?.length) {
      lines.push({ text: t('safety.avoidIgnored', { names: plan.avoidedUsed.join(', '), n: plan.avoidedUsed.length }), ok: false })
    }
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
