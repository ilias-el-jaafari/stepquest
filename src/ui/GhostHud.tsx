import { ghostSprite, type GhostPose } from '../ghost/art.ts'
import type { PacerStatus } from '../ghost/pacer.ts'
import { useI18n } from '../i18n/index.ts'
import { PixelSvg } from './PixelIcons.tsx'
import type { GhostSay } from './useGhost.ts'

type Props = {
  say: GhostSay | undefined
  status: PacerStatus
  /** Another message sits under the top HUD: move down to make room. */
  low?: boolean
}

/**
 * The ghost's speech bubble in the quest HUD. A line the ghost says wins over the pace status. The
 * status text lives in a polite live region that is always on screen (hidden from sight when empty), so
 * screen readers hear every change; the bubble itself is decoration for the same words.
 */
export function GhostHud({ say, status, low = false }: Props) {
  const { t } = useI18n()
  const paceKey = status === 'ahead' ? 'ghost.pace.ahead' : status === 'behind' ? 'ghost.pace.behind' : status === 'on' ? 'ghost.pace.on' : undefined
  const text = say ? t(say.key) : paceKey ? t(paceKey) : ''
  const pose: GhostPose = say?.pose ?? 'float'
  return (
    <>
      <div className={`ghost-hud ${low ? 'low' : ''} ${text ? '' : 'quiet'} ${status === 'behind' && !say ? 'behind' : ''}`} data-testid="ghost-hud" data-pose={pose} aria-hidden="true">
        <span key={say?.id ?? 0} className={`ghost-face ${pose === 'boo' ? 'pop' : ''}`}>
          <PixelSvg art={ghostSprite(pose)} size={32} />
        </span>
        <span className="ghost-text">{text}</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-label={t('ghost.label')} data-testid="ghost-live">
        {text}
      </p>
    </>
  )
}
