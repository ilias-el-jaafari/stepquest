import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.ts'
import { formatDistance, formatNumber } from '../i18n/format.ts'
import { directionTo } from '../quest/compass.ts'
import { formatDuration, formatPace, nextCheckpoint, questStats, routeToNext, signalStatus, trackFor, type QuestState } from '../quest/quest.ts'
import { snapToRoute } from '../quest/snap.ts'
import { summarize, type Summary } from '../quest/summary.ts'
import type { Sprite } from '../render/sprites.ts'
import type { LocationErrorCode } from '../quest/geolocation.ts'
import type { BBox, LatLon } from '../geo/geo.ts'
import type { MapSource } from '../render/mapSource.ts'
import type { MapLoad } from '../world/streamer.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { DEMO_FINISH_CLOSE_MS, DEMO_NEXT_LINE_MS, demoCameraBlend, demoClockAt, demoProgress } from '../demo/script.ts'
import { prefersReducedMotion } from '../render/env.ts'
import { useAudio } from '../audio/useAudio.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { DialogueBox } from './DialogueBox.tsx'
import type { LodLayer } from '../lod/layer.ts'
import { MapView } from './MapView.tsx'
import { SummaryScreen } from './SummaryScreen.tsx'
import { SoundMenu } from './SoundMenu.tsx'
import type { Pickup } from './useQuestRunner.ts'

type Props = {
  map: TileGrid | MapSource
  /** Where the view is, for streaming the cells around it (new cells only add drawing). */
  onViewBox?: (box: BBox, centre: LatLon, zoom?: number) => void
  /** The level-of-detail layer around the hero (requirement 25); absent when it is off. */
  lod?: LodLayer
  /** What the map shows now (read-only state on the map element). */
  load?: MapLoad
  quest: QuestState
  pickup: Pickup | undefined
  error: LocationErrorCode | undefined
  wakeActive: boolean
  resumed: boolean
  /** The player's hero, for the summary celebration. */
  walker: Sprite
  onEnd: () => void
  onUseSim: () => void
  /** The self-playing run: day cycle and camera follow the walk, dialogues close by themselves. */
  demo?: boolean
}

/** Words of the "end this quest?" question. */
const END_CONFIRM = { message: 'quest.endConfirm', yes: 'quest.endYes', no: 'quest.endNo' } as const
const EMPTY_MARKERS = {}
const ignoreTap = () => {}

function boundsOf(points: readonly LatLon[]): BBox {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of points) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lon)
    east = Math.max(east, p.lon)
  }
  return { south, west, north, east }
}

/** A small stable number from the quest id (the seed of the celebration). */
function seedOf(id: string): number {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** The HUD sits 10 px above the screen edge; the stack's own bottom margin is 8 px, plus a little air. */
const HUD_GAP = 6

export function QuestScreen({ map, onViewBox, lod, load, quest, pickup, error, wakeActive, resumed, walker, onEnd, onUseSim, demo = false }: Props) {
  const { t, locale } = useI18n()
  const { engine, status, settings: sound, phrase } = useAudio()
  const [now, setNow] = useState(() => Date.now())
  const [follow, setFollow] = useState(true)
  // The bottom HUD overlays the map; the map buttons keep clear of it.
  const hudBottom = useRef<HTMLDivElement>(null)
  const [hudHeight, setHudHeight] = useState(0)
  useEffect(() => {
    const el = hudBottom.current
    if (!el) return
    const read = () => setHudHeight(el.offsetHeight)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  /** The stats panel starts folded so the map gets the screen. */
  const [statsOpen, setStatsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(0)
  const [confirming, setConfirming] = useState(false)
  // The summary: closed with "Back to map" (finished), or the paused one with the numbers of the moment "End" was confirmed.
  const [completeClosed, setCompleteClosed] = useState(false)
  const [paused, setPaused] = useState<Summary | undefined>()
  const [showResumed, setShowResumed] = useState(resumed)
  // Dialogue boxes: the welcome line (not after a resume) and the finish speech.
  const [startDone, setStartDone] = useState(resumed || quest.collected > 0)
  // A quest that was already finished before a reload goes straight to the results.
  const [finishDone, setFinishDone] = useState(resumed && quest.finishedAt !== undefined)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // A pickup dialogue shows for the latest checkpoint until it closes (tap or timer).
  const pickupShown = pickup && pickup.index < pickup.total && pickup.n !== dismissed ? pickup : undefined
  const closePickup = useCallback(() => setDismissed(pickup?.n ?? 0), [pickup])
  const closeStart = useCallback(() => setStartDone(true), [])
  const closeFinish = useCallback(() => setFinishDone(true), [])

  useEffect(() => {
    if (!showResumed) return
    const id = setTimeout(() => setShowResumed(false), 2500)
    return () => clearTimeout(id)
  }, [showResumed])

  // The simulator runs on its own clock; real quests use the wall clock.
  const clock = quest.simulated ? (quest.lastFixAt ?? quest.startedAt) : now
  const stats = questStats(quest, clock)
  const next = nextCheckpoint(quest)
  const player = quest.player
  const overlay = useMemo(
    () => ({ player: quest.player, accuracyM: quest.simulated ? undefined : quest.accuracy, collected: quest.collected, alongM: quest.alongM, walkedBefore: quest.walkedBefore }),
    [quest.player, quest.accuracy, quest.collected, quest.alongM, quest.simulated, quest.walkedBefore],
  )
  const markers = EMPTY_MARKERS
  const stopFollowing = useCallback(() => setFollow(false), [])
  const startFollowing = useCallback(() => setFollow(true), [])
  // Demo run: the clock and the camera follow how far along the route the walker is; a tap hands the camera back.
  const [autoCamera, setAutoCamera] = useState(() => demo && !prefersReducedMotion())
  // The "tap for sound" button is the one tap that keeps the camera going (the demo starts with sound waiting for a tap).
  const stopAutoCamera = useCallback((e: { target: EventTarget | null }) => {
    if (!(e.target instanceof Element && e.target.closest('.sound-resume'))) setAutoCamera(false)
  }, [])
  const routeBounds = useMemo(() => (demo ? boundsOf(quest.route.points) : undefined), [demo, quest.route.points])
  const progress = demoProgress(quest.alongM, trackFor(quest.route).total, quest.finishedAt !== undefined)
  const clockAt = demo ? demoClockAt(progress) : undefined
  const blend = demoCameraBlend(progress)
  const shot = useMemo(() => (autoCamera && routeBounds && quest.finishedAt === undefined ? { blend, bounds: routeBounds } : undefined), [autoCamera, routeBounds, blend, quest.finishedAt])
  // Frame the walker once when the quest screen opens (the parent keys this component by quest id).
  const [focus] = useState(() => (player ? [player] : []))

  let nextLine = ''
  let nextDist = ''
  let nextDir: { bearing: number; label: string } | undefined
  const ahead = routeToNext(quest)
  if (next && player && ahead) {
    // Distance along the route, and the way to walk now (not a straight line to the gem).
    const dir = directionTo(player, ahead.toward)
    nextLine = next.isFinish ? t('quest.nextFinish') : t('quest.next', { n: next.index })
    nextDist = formatDistance(ahead.metres, locale)
    nextDir = { bearing: dir.bearing, label: t(`dir.${dir.point}`) }
  }

  let message: { text: string; tone: 'warn' | 'bad' } | undefined
  const signal = signalStatus(quest, now)
  // Once the quest is finished, GPS no longer matters: no signal or route warnings.
  if (signal === 'finished') message = undefined
  else if (error === 'denied' || error === 'unsupported' || error === 'insecure') message = { text: t(`quest.err.${error}`), tone: 'bad' }
  else if (quest.lost && player) {
    const snap = snapToRoute(trackFor(quest.route), player, quest.alongM)
    const dir = directionTo(player, snap.point)
    message = { text: t('quest.offRoute', { dir: t(`dir.${dir.point}`), m: Math.round(snap.offsetM) }), tone: 'warn' }
  } else if (signal === 'lost') message = { text: t('quest.lost'), tone: 'warn' }
  else if (signal === 'weak') message = { text: t('quest.weak'), tone: 'warn' }
  else if (error) message = { text: t(`quest.err.${error}`), tone: 'warn' }

  // iOS suspends audio after calls, Siri or a locked screen; a tap brings it back.
  const soundPaused = quest.finishedAt === undefined && !sound.muted && engine.supported && status !== 'running' && status !== 'closed'

  // The demo run (?demo=1) is a recording: it shows no "Simulation ×N" badge. A real quest on the simulator keeps it.
  const gps = quest.simulated
    ? demo
      ? ''
      : t('quest.simBadge', { x: quest.sim?.timeScale ?? 1 })
    : quest.lastFixAt === undefined
      ? t('quest.waiting')
      : t('quest.gps', { m: Math.round(quest.accuracy ?? 0) })

  const finished = quest.finishedAt !== undefined
  let dialogue: { key: string; kind: 'start' | 'pickup' | 'finish'; lines: string[]; onDone: () => void; autoCloseMs?: number } | undefined
  if (finished && !finishDone) {
    dialogue = {
      key: 'finish',
      kind: 'finish',
      lines: [t('dlg.finish1'), t('dlg.finish2', { steps: formatNumber(stats.steps, locale), km: formatDistance(stats.walkedM, locale) })],
      onDone: closeFinish,
      autoCloseMs: demo ? DEMO_FINISH_CLOSE_MS : undefined,
    }
  } else if (!finished && pickupShown) {
    const left = pickupShown.total - pickupShown.index
    dialogue = {
      key: `pickup-${pickupShown.n}`,
      kind: 'pickup',
      lines: [left <= 1 ? t('dlg.pickupLast', { n: pickupShown.index, total: pickupShown.total }) : t('dlg.pickup', { n: pickupShown.index, total: pickupShown.total, left })],
      onDone: closePickup,
      autoCloseMs: 2600,
    }
  } else if (!finished && !startDone) {
    dialogue = {
      key: 'start',
      kind: 'start',
      lines: quest.route.checkpoints.length > 1 ? [t('dlg.start1', { n: quest.route.checkpoints.length - 1 }), t('dlg.start2')] : [t('dlg.startFlag')],
      onDone: closeStart,
      autoCloseMs: 5000,
    }
  }

  // A finished quest ends at once; a running one asks first, in the app's own dialog.
  const askEnd = () => (quest.finishedAt !== undefined ? onEnd() : setConfirming(true))

  // "End" confirmed: show how far the walk got; the quest itself goes on until a summary button is chosen.
  const pauseHere = () => {
    setConfirming(false)
    setPaused(summarize(stats, 'paused'))
  }

  return (
    <div className="quest" data-testid="quest">
      {/* A generic handheld console: plastic body, dark bezel with a power light, the map as its screen. */}
      <div className="console">
        <div className="console-bezel">
          <span className="console-led" aria-hidden="true" />
          <div className="console-screen" data-testid="console-screen" onPointerDownCapture={demo ? stopAutoCamera : undefined}>
            <div className="quest-map">
              <MapView
                map={map}
                onViewBox={onViewBox}
                lod={lod}
                load={load}
                route={quest.route}
                markers={markers}
                focus={focus}
                focusKey={`quest:${quest.id}`}
                onTap={ignoreTap}
                home={player}
                quest={overlay}
                follow={follow && quest.finishedAt === undefined}
                pickup={pickup}
                bubble={phrase?.text}
                onUserPan={stopFollowing}
                onLocate={startFollowing}
                bottomReserve={hudHeight + HUD_GAP}
                clockAt={clockAt}
                shot={shot}
              />
            </div>

            <div className="hud hud-top" data-testid="hud">
              <div className="hud-next">
                <span className="gem" aria-hidden="true" />
                <div>
                  <div className="hud-label">{nextLine}</div>
                  <div className="hud-big" data-testid="next-distance">
                    {nextDist}
                    {nextDir && (
                      <>
                        {' '}
                        <span className="arrow" style={{ transform: `rotate(${Math.round(nextDir.bearing / 45) * 45}deg)` }} aria-hidden="true">
                          ↑
                        </span>{' '}
                        {nextDir.label}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="hud-count">
                <div className="hud-label">{t('quest.collected')}</div>
                <div className="hud-big" data-testid="collected">
                  {stats.collected}/{stats.total}
                </div>
              </div>
              {(gps || wakeActive) && (
                <div className={`hud-gps ${quest.simulated ? 'sim' : ''}`} data-testid="hud-gps">
                  {gps}
                  {wakeActive && (
                    <span className="wake">
                      {gps ? ' · ' : ''}
                      {t('quest.wakeLock')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {message && (
              <div className={`hud-msg ${message.tone}`} role="status">
                {message.text}
                {error === 'denied' && (
                  <button type="button" className="pix-btn small-text" onClick={onUseSim}>
                    {t('quest.useSim')}
                  </button>
                )}
              </div>
            )}
            {showResumed && !message && !finished && <div className="hud-msg info">{t('quest.resumed')}</div>}
            {soundPaused && !message && (
              <button type="button" className="hud-msg info sound-resume" onClick={() => engine.unlock()} data-testid="sound-resume">
                {t('sound.resume')}
              </button>
            )}

            {dialogue && (
              <div className="dialog-wrap">
                <DialogueBox key={dialogue.key} kind={dialogue.kind} lines={dialogue.lines} onDone={dialogue.onDone} autoCloseMs={dialogue.autoCloseMs} autoNextMs={demo ? DEMO_NEXT_LINE_MS : undefined} />
              </div>
            )}

            <div ref={hudBottom} className={`hud hud-bottom ${statsOpen ? '' : 'folded'}`} data-testid="hud-bottom">
              <dl className="hud-stats">
                <div>
                  <dt>{t('quest.walked')}</dt>
                  <dd data-testid="walked">{formatDistance(stats.walkedM, locale)}</dd>
                </div>
                <div>
                  <dt>{t('quest.steps')}</dt>
                  <dd data-testid="quest-steps">{formatNumber(stats.steps, locale)}</dd>
                </div>
                <div>
                  <dt>{t('quest.time')}</dt>
                  <dd>{formatDuration(stats.elapsedMs)}</dd>
                </div>
                <div>
                  <dt>{t('quest.pace')}</dt>
                  <dd>
                    {formatPace(stats.paceMinPerKm)}
                    <small>{t('quest.paceUnit')}</small>
                  </dd>
                </div>
              </dl>
              <div className="hud-buttons">
                {!follow && (
                  <button type="button" className="pix-btn small-text" onClick={() => setFollow(true)}>
                    {t('quest.follow')}
                  </button>
                )}
                <button
                  type="button"
                  className="pix-btn round hud-fold"
                  aria-expanded={statsOpen}
                  aria-label={t(statsOpen ? 'hud.less' : 'hud.more')}
                  title={t(statsOpen ? 'hud.less' : 'hud.more')}
                  onClick={() => setStatsOpen(!statsOpen)}
                  data-testid="hud-fold"
                >
                  <span className={`chev ${statsOpen ? 'down' : 'up'}`} aria-hidden="true" />
                </button>
                <SoundMenu placement="up" showLabel={false} />
                <button type="button" className="pix-btn small-text danger" onClick={askEnd}>
                  {t('quest.end')}
                </button>
              </div>
            </div>

            {finished && finishDone && !completeClosed && (
              <SummaryScreen summary={summarize(stats, 'complete')} walker={walker} seed={seedOf(quest.id)} onBack={() => setCompleteClosed(true)} onNew={onEnd} />
            )}
            {!finished && paused && <SummaryScreen summary={paused} walker={walker} seed={seedOf(quest.id)} onBack={() => setPaused(undefined)} onNew={onEnd} />}
            {confirming && <ConfirmDialog {...END_CONFIRM} testId="confirm-end" onYes={pauseHere} onNo={() => setConfirming(false)} />}
          </div>
        </div>
      </div>
    </div>
  )
}
