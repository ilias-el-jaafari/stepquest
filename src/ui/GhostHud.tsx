import { ghostSprite, type GhostPose } from '../ghost/art.ts'
import type { PacerStatus } from '../ghost/pacer.ts'
import { useI18n } from '../i18n/index.ts'
import { PixelSvg } from './PixelIcons.tsx'
import type { GhostSay } from './useGhost.ts'

type Props = {
  say: GhostSay | undefined
  status: PacerStatus
  /** Metres from the hero to Wisp's pace point (positive: the hero is ahead). Shown under the status once the warm-up is over. */
  gapM?: number
}

/** Gaps under this many metres read as "on pace" and show no number. */
export const GAP_SHOWN_M = 5

/**
 * Wisp's chip at the top of the quest's bottom card (always on screen, folded or not, clear of the map buttons). A line the ghost says wins over the pace status. The
 * status text lives in a polite live region that is always on screen (hidden from sight when empty), so
 * screen readers hear every change; the bubble itself is decoration for the same words.
 */
export function GhostHud({ say, status, gapM }: Props) {
  const { t } = useI18n()
  const paceKey = status === 'ahead' ? 'ghost.pace.ahead' : status === 'behind' ? 'ghost.pace.behind' : status === 'on' ? 'ghost.pace.on' : undefined
  const text = say ? t(say.key) : paceKey ? t(paceKey) : ''
  const pose: GhostPose = say?.pose ?? 'float'
  const showGap = gapM !== undefined && status !== 'warmup' && Math.abs(gapM) >= GAP_SHOWN_M
  const gapText = showGap ? t(gapM > 0 ? 'ghost.gapBehind' : 'ghost.gapAhead', { m: Math.abs(gapM) }) : ''
  return (
    <>
      <div className={`ghost-hud ${text ? '' : 'quiet'} ${status === 'behind' && !say ? 'behind' : ''}`} data-testid="ghost-hud" data-pose={pose} aria-hidden="true">
        <span key={say?.id ?? 0} className={`ghost-face ${pose === 'boo' ? 'pop' : ''}`}>
          <PixelSvg art={ghostSprite(pose)} size={32} />
        </span>
        <span className="ghost-text">
          {text}
          {gapText && <span className="ghost-gap" data-testid="ghost-gap">{gapText}</span>}
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-label={t('ghost.label')} data-testid="ghost-live">
        {text}
      </p>
    </>
  )
}
