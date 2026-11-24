import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bboxContains, type LatLon } from './geo/geo.ts'
import { formatDecimal } from './i18n/format.ts'
import { useI18n } from './i18n/index.ts'
import { nearestStreet, avoidedPolylines, streetNames } from './routing/safety.ts'
import { addAvoid, removeAvoid, saveAvoid } from './ui/avoidList.ts'
import { Onboarding } from './ui/Onboarding.tsx'
import { markOnboardingSeen } from './ui/onboarding.ts'
import { createQuest, type AreaRef, type QuestState } from './quest/quest.ts'
import type { ReroutePatch } from './quest/reroute.ts'
import { audioEngine } from './audio/engine.ts'
import { MapView } from './ui/MapView.tsx'
import { QuestScreen } from './ui/QuestScreen.tsx'
import { TabBar } from './ui/TabBar.tsx'
import { Sheet } from './ui/Sheet.tsx'
import { walkerFor } from './hero/look.ts'
import { useLook } from './hero/useLook.ts'
import { deviceVibrate, installPressFeedback } from './ui/pressFeedback.ts'
import { useQuestRunner } from './ui/useQuestRunner.ts'
import { clampSteps, parseCoords, saveSettings } from './ui/settings.ts'
import { AppHeader } from './ui/AppHeader.tsx'
import { BagContent, type SimOptions } from './ui/BagSheet.tsx'
import { HeroContent } from './ui/HeroSheet.tsx'
import { MapBanners } from './ui/MapBanners.tsx'
import { PlannerPanel } from './ui/PlannerPanel.tsx'
import { SettingsContent } from './ui/SettingsSheet.tsx'
import { UpdateBanner } from './ui/UpdateBanner.tsx'
import { useOnline } from './app/useOnline.ts'
import { useAppState } from './app/useAppState.ts'
import { useArea } from './app/useArea.ts'
import { useNumberFields } from './app/useNumberFields.ts'
import { usePlanner } from './app/usePlanner.ts'
import { useToday } from './app/useToday.ts'

type Reroute = (q: QuestState) => Promise<ReroutePatch | undefined>

/** Screen layout and wiring. State lives in `app/` (reducer and hooks); the pieces on screen are in `ui/`. */
export default function App() {
  const { t, locale } = useI18n()
  const walkerArt = walkerFor(useLook()).down[0]!
  const { state, dispatch, latest } = useAppState()
  const { settings } = state
  const today = useToday()
  const online = useOnline()
  const [sim, setSim] = useState<SimOptions>({ simulate: false, speed: 20, noise: true })
  const mapWrap = useRef<HTMLElement>(null)

  const getSettings = useCallback(() => latest.current.settings, [latest])
  const fields = useNumberFields({ settings, latest: getSettings, dispatch })
  const { commitStepsField, commitStrideField } = fields
  const commitFields = useCallback(() => ({ targetSteps: commitStepsField(), strideM: commitStrideField() }), [commitStepsField, commitStrideField])

  // The planner and the area loader need each other's output (the world; the quest runner), so
  // the runner is created first and handed the reroute function through a ref-stable wrapper.
  const rerouteRef = useRef<Reroute>(async () => undefined)
  const reroute = useCallback<Reroute>((q) => rerouteRef.current(q), [])
  const runner = useQuestRunner(reroute)
  const questActive = !!runner.quest
  const { world, live, locateMe, loadLiveAround, loadView, backToDemo, retryBoot } = useArea({ state, latest, dispatch, beginQuest: runner.begin, questActive })
  const planner = usePlanner({
    world,
    latest,
    dispatch,
    commitFields,
    // On phones the panel sits under the map: bring the map back into view.
    onPlanned: () => {
      const map = mapWrap.current
      if (map && map.getBoundingClientRect().bottom < 120) map.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })
  useEffect(() => {
    rerouteRef.current = planner.reroute
  })

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveAvoid([...state.avoid]), [state.avoid])

  // Planning screen: calm music at a steady tempo, starting on the first tap (autoplay rules).
  useEffect(() => {
    if (questActive) return
    const audio = audioEngine()
    audio.armUnlock()
    audio.playMenuMusic()
  }, [questActive])

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

  const streets = useMemo(() => (world ? streetNames(world.data) : []), [world])
  const avoidedLines = useMemo(() => (world ? avoidedPolylines(world.data, state.avoid) : []), [world, state.avoid])

  const onTap = useCallback(
    (p: LatLon) => {
      if (latest.current.pickingAvoid) dispatch({ type: 'pickStreet', name: world ? nearestStreet(world.data, p) : undefined })
      else dispatch({ type: 'point', p })
    },
    [latest, dispatch, world],
  )
  const onLocate = useCallback(() => void locateMe(), [locateMe])
  const onView = useCallback((centre: LatLon) => dispatch({ type: 'view', centre }), [dispatch])

  const { result, start, end } = state
  const shown = result?.ok ? result.route : result?.closest
  const markers = useMemo(() => ({ start, end: settings.mode === 'oneway' ? end : undefined }), [start, end, settings.mode])
  const focus = useMemo<LatLon[]>(() => {
    if (shown) return shown.points
    return settings.mode === 'oneway' && end ? [start, end] : [start]
  }, [shown, start, end, settings.mode])
  const focusKey = shown ? `route:${shown.nodes.length}:${shown.distanceM}` : `pts:${settings.mode}:${end ? 'e' : ''}:${world ? 'w' : ''}`

  const outsideView = !!world && !!state.viewCentre && !bboxContains(world.data.bbox, state.viewCentre)
  const loadingMb = live.status.state === 'loading' ? formatDecimal(live.status.bytes / 1e6, locale, 1) : undefined
  const locating = state.locate.state === 'locating' || state.locate.state === 'loadingArea'

  // Leaving a quest: the session adds the real steps still unpaid to today's total (the rest was added as they were walked).
  const beginning = useRef(false)
  const endQuest = () => {
    runner.end()
    beginning.current = false
    today.refresh()
  }

  const startQuest = () => {
    const s = latest.current
    if (!s.result?.ok || beginning.current) return
    beginning.current = true
    const area: AreaRef = s.isDemo || !s.liveBox ? { kind: 'demo' } : { kind: 'live', bbox: s.liveBox }
    const r = s.result.route
    dispatch({ type: 'questStarted' })
    runner.begin(
      createQuest(
        { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints },
        { strideM: s.settings.strideM, area, simulated: sim.simulate, now: Date.now(), sim: sim.simulate ? { timeScale: sim.speed, noiseM: sim.noise ? 5 : 0 } : undefined },
      ),
    )
  }

  const loadFromCoords = () => {
    const coords = parseCoords(state.coordsText)
    dispatch({ type: 'coordsError', on: !coords })
    if (coords) void loadLiveAround(coords)
  }

  if (runner.quest && world) {
    return (
      <QuestScreen
        key={runner.quest.id}
        grid={world.grid}
        quest={runner.quest}
        pickup={runner.pickup}
        error={runner.error}
        wakeActive={runner.wakeActive}
        resumed={state.resumed}
        onEnd={endQuest}
        onUseSim={() => runner.switchToSimulation(sim.speed)}
      />
    )
  }

  const { tab } = state
  const plannerFolded = !!result?.ok && !state.plannerOpen

  return (
    <>
      <div className={`app tab-${tab}`} inert={state.intro}>
        <AppHeader walker={walkerArt} todaySteps={today.steps} />
        {!online && (
          <p className="net-banner" role="status" data-testid="offline">
            {t('net.offline')}
          </p>
        )}
        <UpdateBanner />

        <main className="layout">
          <section className="map-wrap" ref={mapWrap}>
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
                onLocate={onLocate}
                locating={locating}
                onView={onView}
              />
            ) : state.mapStatus === 'failed' ? (
              <div className="map map-loading map-error" data-testid="map-error">
                <p role="alert">{t('map.error')}</p>
                <button type="button" className="pix-btn" data-testid="map-retry" onClick={() => void retryBoot()}>
                  {t('map.retry')}
                </button>
              </div>
            ) : (
              <div className="map map-loading" role="status">
                {t('map.loading')}
              </div>
            )}
            {state.resumeFailed && (
              <div className="map-banner top" role="status" data-testid="resume-failed">
                <span>{t('quest.resumeFailed')}</span>
              </div>
            )}
            <MapBanners
              picking={state.pickingAvoid}
              noStreet={state.pickNote?.ok === false}
              loadingMb={loadingMb}
              outsideView={outsideView}
              askHere={state.askHere}
              errorCode={live.status.state === 'error' ? live.status.code : undefined}
              onCancelPick={() => dispatch({ type: 'pickCancel' })}
              onLoadView={() => void loadView()}
              onLocate={onLocate}
              onDismissAsk={() => dispatch({ type: 'askHere', on: false })}
            />
          </section>

          {/* Map tab: the planner, framed above the tab bar. */}
          <Sheet tab="map" active={tab === 'map'} className="planner">
            <PlannerPanel
              settings={settings}
              placing={state.placing}
              hasEnd={!!end}
              result={result}
              planning={state.plan.status === 'running'}
              planFailed={state.plan.status === 'failed'}
              folded={plannerFolded}
              locate={state.locate}
              simulate={sim.simulate}
              mapReady={!!world}
              fields={fields}
              onMode={(mode) => dispatch({ type: 'mode', mode })}
              onPlace={(which) => dispatch({ type: 'place', which })}
              onToggle={() => dispatch({ type: 'togglePlanner' })}
              onPlan={planner.plan}
              onStart={startQuest}
            />
          </Sheet>

          {/* Bag: the quest log and the route kit (start point, streets to avoid). */}
          <Sheet tab="bag" active={tab === 'bag'}>
            <BagContent
              result={result}
              safePlan={state.safePlan}
              usingNormal={state.usingNormal}
              sim={sim}
              mode={settings.mode}
              start={start}
              end={end}
              isDemo={state.isDemo}
              locate={state.locate}
              avoid={state.avoid}
              streets={streets}
              picking={state.pickingAvoid}
              pickNote={state.pickNote}
              onUseSteps={(steps) => fields.setSteps(clampSteps(steps))}
              onUseNormal={() => dispatch({ type: 'useNormal' })}
              onSim={(patch) => setSim((s) => ({ ...s, ...patch }))}
              onLocate={onLocate}
              onResetPoints={() => dispatch({ type: 'resetPoints' })}
              onAvoid={(name) => dispatch({ type: 'avoid', list: addAvoid(latest.current.avoid, name) })}
              onUnavoid={(name) => dispatch({ type: 'avoid', list: removeAvoid(latest.current.avoid, name) })}
              onPick={(on) => dispatch({ type: 'pickMode', on })}
            />
          </Sheet>

          {/* Hero: the walker, today's steps and the stride. */}
          <Sheet tab="hero" active={tab === 'hero'}>
            <HeroContent art={walkerArt} todaySteps={today.steps} targetSteps={settings.targetSteps} strideM={settings.strideM} fields={fields} />
          </Sheet>

          {/* Settings: sound, language, map data and help. */}
          <Sheet tab="settings" active={tab === 'settings'}>
            <SettingsContent
              start={start}
              now={today.now}
              isDemo={state.isDemo}
              coordsText={state.coordsText}
              coordsError={state.coordsError}
              liveStatus={live.status}
              onCoordsText={(text) => dispatch({ type: 'coords', text })}
              onLoadLive={loadFromCoords}
              onBackToDemo={() => void backToDemo()}
              onShowIntro={() => dispatch({ type: 'intro', open: true })}
            />
          </Sheet>
        </main>

        <TabBar tab={tab} onTab={(next) => dispatch({ type: 'tab', tab: next })} />
      </div>
      {state.intro && (
        <Onboarding
          onClose={() => {
            markOnboardingSeen()
            dispatch({ type: 'intro', open: false })
          }}
        />
      )}
    </>
  )
}
