import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.ts'
import { directionTo } from '../quest/compass.ts'
import { formatDuration, formatPace, nextCheckpoint, questStats, routeToNext, trackFor, type QuestState } from '../quest/quest.ts'
import { snapToRoute } from '../quest/snap.ts'
import type { LocationErrorCode } from '../quest/geolocation.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { useAudio } from '../audio/useAudio.ts'
import { DialogueBox } from './DialogueBox.tsx'
import { MapView } from './MapView.tsx'
import { SoundMenu } from './SoundMenu.tsx'
import type { Pickup } from './useQuestRunner.ts'

type Props = {
  grid: TileGrid
  quest: QuestState
  pickup: Pickup | undefined
  error: LocationErrorCode | undefined
  wakeActive: boolean
  resumed: boolean
  onEnd: () => void
  onUseSim: () => void
}

const LOST_AFTER_MS = 30_000
const WEAK_AFTER_MS = 5_000

function fmtDistance(m: number, locale: string): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
}

export function QuestScreen({ grid, quest, pickup, error, wakeActive, resumed, onEnd, onUseSim }: Props) {
  const { t, locale } = useI18n()
  const { engine, status, settings: sound, phrase } = useAudio()
  const [now, setNow] = useState(() => Date.now())
  const [follow, setFollow] = useState(true)
  /** The stats panel starts folded so the map gets the screen. */
  const [statsOpen, setStatsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(0)
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
  const markers = useMemo(() => ({}), [])
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
    nextDist = fmtDistance(ahead.metres, locale)
    nextDir = { bearing: dir.bearing, label: t(`dir.${dir.point}`) }
  }

  let message: { text: string; tone: 'warn' | 'bad' } | undefined
  // Once the quest is finished, GPS no longer matters: no signal or route warnings.
  if (quest.finishedAt !== undefined) message = undefined
  else if (error === 'denied' || error === 'unsupported' || error === 'insecure') message = { text: t(`quest.err.${error}`), tone: 'bad' }
  else if (quest.lost && player) {
    const snap = snapToRoute(trackFor(quest.route), player, quest.alongM)
    const dir = directionTo(player, snap.point)
    message = { text: t('quest.offRoute', { dir: t(`dir.${dir.point}`), m: Math.round(snap.offsetM) }), tone: 'warn' }
  } else if (!quest.simulated && quest.lastFixAt !== undefined && now - quest.lastFixAt > LOST_AFTER_MS) message = { text: t('quest.lost'), tone: 'warn' }
  else if (quest.weakSince !== undefined && now - quest.weakSince > WEAK_AFTER_MS) message = { text: t('quest.weak'), tone: 'warn' }
  else if (error) message = { text: t(`quest.err.${error}`), tone: 'warn' }

  // iOS suspends audio after calls, Siri or a locked screen; a tap brings it back.
  const soundPaused = quest.finishedAt === undefined && !sound.muted && engine.supported && status !== 'running' && status !== 'closed'

  const gps = quest.simulated
    ? t('quest.simBadge', { x: quest.sim?.timeScale ?? 1 })
    : quest.lastFixAt === undefined
      ? t('quest.waiting')
      : t('quest.gps', { m: Math.round(quest.accuracy ?? 0) })

  const finished = quest.finishedAt !== undefined
  let dialogue: { key: string; kind: 'start' | 'pickup' | 'finish'; lines: string[]; onDone: () => void; autoCloseMs?: number } | undefined
  if (finished && !finishDone) {
    dialogue = {
      key: 'finish',
      kind: 'finish',
      lines: [t('dlg.finish1'), t('dlg.finish2', { steps: stats.steps.toLocaleString(locale), km: fmtDistance(stats.walkedM, locale) })],
      onDone: closeFinish,
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

  const confirmEnd = () => {
    if (quest.finishedAt !== undefined || window.confirm(t('quest.endConfirm'))) onEnd()
  }

  return (
    <div className="quest" data-testid="quest">
      {/* A generic handheld console: plastic body, dark bezel with a power light, the map as its screen. */}
      <div className="console">
        <div className="console-bezel">
          <span className="console-led" aria-hidden="true" />
          <div className="console-screen" data-testid="console-screen">
            <div className="quest-map">
              <MapView
                grid={grid}
                route={quest.route}
                markers={markers}
                focus={focus}
                focusKey={`quest:${quest.id}`}
                onTap={() => {}}
                home={player}
                quest={overlay}
                follow={follow && quest.finishedAt === undefined}
                pickup={pickup}
                bubble={phrase?.text}
                onUserPan={() => setFollow(false)}
                onLocate={() => setFollow(true)}
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
              <div className={`hud-gps ${quest.simulated ? 'sim' : ''}`}>
                {gps}
                {wakeActive && <span className="wake"> · {t('quest.wakeLock')}</span>}
              </div>
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
                <DialogueBox key={dialogue.key} kind={dialogue.kind} lines={dialogue.lines} onDone={dialogue.onDone} autoCloseMs={dialogue.autoCloseMs} />
              </div>
            )}

            <div className={`hud hud-bottom ${statsOpen ? '' : 'folded'}`} data-testid="hud-bottom">
              <dl className="hud-stats">
                <div>
                  <dt>{t('quest.walked')}</dt>
                  <dd data-testid="walked">{fmtDistance(stats.walkedM, locale)}</dd>
                </div>
                <div>
                  <dt>{t('quest.steps')}</dt>
                  <dd data-testid="quest-steps">{stats.steps.toLocaleString(locale)}</dd>
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
                  className="pix-btn small-text hud-fold"
                  aria-expanded={statsOpen}
                  aria-label={t(statsOpen ? 'hud.less' : 'hud.more')}
                  title={t(statsOpen ? 'hud.less' : 'hud.more')}
                  onClick={() => setStatsOpen(!statsOpen)}
                  data-testid="hud-fold"
                >
                  <span className={`chev ${statsOpen ? 'down' : 'up'}`} aria-hidden="true" />
                </button>
                <SoundMenu placement="up" showLabel={false} />
                <button type="button" className="pix-btn small-text danger" onClick={confirmEnd}>
                  {t('quest.end')}
                </button>
              </div>
            </div>

            {finished && finishDone && (
              <div className="complete" role="dialog" aria-modal="true" data-testid="complete">
                <div className="complete-box">
                  <div className="stars" aria-hidden="true">
                    ★ ★ ★
                  </div>
                  <h2>{t('complete.title')}</h2>
                  <p>{t('complete.subtitle', { n: stats.total })}</p>
                  <dl className="complete-stats">
                    <div>
                      <dt>{t('complete.distance')}</dt>
                      <dd>{fmtDistance(stats.walkedM, locale)}</dd>
                    </div>
                    <div>
                      <dt>{t('complete.steps')}</dt>
                      <dd>{stats.steps.toLocaleString(locale)}</dd>
                    </div>
                    <div>
                      <dt>{t('complete.time')}</dt>
                      <dd>{formatDuration(stats.elapsedMs)}</dd>
                    </div>
                    <div>
                      <dt>{t('complete.pace')}</dt>
                      <dd>
                        {formatPace(stats.paceMinPerKm)}
                        {t('quest.paceUnit')}
                      </dd>
                    </div>
                    <div className="wide">
                      <dt>{t('complete.goal')}</dt>
                      <dd>{t('complete.goalValue', { steps: quest.route.targetSteps.toLocaleString(locale) })}</dd>
                    </div>
                  </dl>
                  <button type="button" className="pix-btn primary" onClick={onEnd}>
                    {t('complete.new')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
