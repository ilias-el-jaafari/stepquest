import { useEffect, useMemo, useState } from 'react'
import { haversine } from '../geo/geo.ts'
import { useI18n } from '../i18n/index.ts'
import { directionTo } from '../quest/compass.ts'
import { formatDuration, formatPace, nextCheckpoint, questStats, trackFor, type QuestState } from '../quest/quest.ts'
import { snapToRoute } from '../quest/snap.ts'
import type { LocationErrorCode } from '../quest/geolocation.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { MapView } from './MapView.tsx'
import type { Pickup } from './useQuestRunner.ts'

type Props = {
  grid: TileGrid
  quest: QuestState
  pickup: Pickup | undefined
  error: LocationErrorCode | undefined
  wakeActive: boolean
  muted: boolean
  resumed: boolean
  onMute: (muted: boolean) => void
  onEnd: () => void
  onUseSim: () => void
}

const LOST_AFTER_MS = 30_000
const WEAK_AFTER_MS = 5_000

function fmtDistance(m: number, locale: string): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`
}

export function QuestScreen({ grid, quest, pickup, error, wakeActive, muted, resumed, onMute, onEnd, onUseSim }: Props) {
  const { t, locale } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  const [follow, setFollow] = useState(true)
  const [dismissed, setDismissed] = useState(0)
  const [showResumed, setShowResumed] = useState(resumed)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // The toast shows for the latest pickup until its timer dismisses it.
  const toast = pickup && pickup.index < pickup.total && pickup.n !== dismissed ? pickup : undefined
  useEffect(() => {
    if (!pickup) return
    const id = setTimeout(() => setDismissed(pickup.n), 1800)
    return () => clearTimeout(id)
  }, [pickup])

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
    () => ({ player: quest.player, accuracyM: quest.simulated ? undefined : quest.accuracy, collected: quest.collected, alongM: quest.alongM }),
    [quest.player, quest.accuracy, quest.collected, quest.alongM, quest.simulated],
  )
  const markers = useMemo(() => ({}), [])
  // Frame the walker once when the quest screen opens (the parent keys this component by quest id).
  const [focus] = useState(() => (player ? [player] : []))

  let nextLine = ''
  let nextDist = ''
  let nextDir: { bearing: number; label: string } | undefined
  if (next && player) {
    const dir = directionTo(player, next.point)
    nextLine = next.isFinish ? t('quest.nextFinish') : t('quest.next', { n: next.index })
    nextDist = fmtDistance(haversine(player, next.point), locale)
    nextDir = { bearing: dir.bearing, label: t(`dir.${dir.point}`) }
  }

  let message: { text: string; tone: 'warn' | 'bad' } | undefined
  if (error === 'denied' || error === 'unsupported' || error === 'insecure') message = { text: t(`quest.err.${error}`), tone: 'bad' }
  else if (quest.offRoute && player) {
    const snap = snapToRoute(trackFor(quest.route), player, quest.alongM)
    const dir = directionTo(player, snap.point)
    message = { text: t('quest.offRoute', { dir: t(`dir.${dir.point}`), m: Math.round(snap.offsetM) }), tone: 'warn' }
  } else if (!quest.simulated && quest.lastFixAt !== undefined && now - quest.lastFixAt > LOST_AFTER_MS) message = { text: t('quest.lost'), tone: 'warn' }
  else if (quest.weakSince !== undefined && now - quest.weakSince > WEAK_AFTER_MS) message = { text: t('quest.weak'), tone: 'warn' }
  else if (error) message = { text: t(`quest.err.${error}`), tone: 'warn' }

  const gps = quest.simulated
    ? t('quest.simBadge', { x: quest.sim?.timeScale ?? 1 })
    : quest.lastFixAt === undefined
      ? t('quest.waiting')
      : t('quest.gps', { m: Math.round(quest.accuracy ?? 0) })

  const confirmEnd = () => {
    if (quest.finishedAt !== undefined || window.confirm(t('quest.endConfirm'))) onEnd()
  }

  return (
    <div className="quest" data-testid="quest">
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
          onUserPan={() => setFollow(false)}
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
      {showResumed && !message && <div className="hud-msg info">{t('quest.resumed')}</div>}

      {toast && (
        <div className="pickup-toast" key={toast.n} data-testid="pickup-toast">
          {t('quest.pickup', { n: toast.index, total: toast.total })}
        </div>
      )}

      <div className="hud hud-bottom">
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
          <button type="button" className="pix-btn small-text" onClick={() => onMute(!muted)}>
            {muted ? t('quest.unmute') : t('quest.mute')}
          </button>
          <button type="button" className="pix-btn small-text danger" onClick={confirmEnd}>
            {t('quest.end')}
          </button>
        </div>
      </div>

      {quest.finishedAt !== undefined && (
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
  )
}
