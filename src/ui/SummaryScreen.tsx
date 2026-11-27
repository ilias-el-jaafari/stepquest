import { useEffect, useId, useRef, useState } from 'react'
import { audioEngine } from '../audio/engine.ts'
import { formatDistance, formatNumber } from '../i18n/format.ts'
import { useI18n } from '../i18n/index.ts'
import { formatDuration, formatPace } from '../quest/quest.ts'
import type { Summary } from '../quest/summary.ts'
import { prefersReducedMotion } from '../render/env.ts'
import type { Sprite } from '../render/sprites.ts'
import { createShow, showIsOver, showPixels, stepShow, type Show } from './celebration.ts'
import { GHOST_FLOAT, GHOST_HAPPY } from '../ghost/art.ts'
import { PixelSvg } from './PixelIcons.tsx'
import { useModal } from './useModal.ts'

type Props = {
  summary: Summary
  /** The player's own hero. */
  walker: Sprite
  /** Seed of the celebration (the quest id), so a reload draws the same fireworks. */
  seed: number
  onBack: () => void
  onNew: () => void
}

/** One logical pixel of the celebration is this many CSS pixels. */
const PIXEL = 4
const FALLBACK = { w: 80, h: 140 }

/**
 * The end-of-quest screen: a full-screen dialog with the stats, the title earned and a pixel
 * celebration (confetti, fireworks, a hopping hero). "Paused" is the calm variant.
 */
export function SummaryScreen({ summary, walker, seed, onBack, onNew }: Props) {
  const { t, locale } = useI18n()
  const panel = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const titleId = useId()
  const calm = summary.kind === 'paused'
  // Read once per opening: the setting does not change under a screen that lasts a few seconds.
  const [still] = useState(prefersReducedMotion)
  useModal(panel)

  // The fanfare goes through the effects bus, so mute and "voice only" silence it.
  useEffect(() => {
    audioEngine().playSfx(calm ? 'rest' : 'fanfare')
  }, [calm])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const box = el.parentElement
    const w = box && box.clientWidth > 0 ? Math.ceil(box.clientWidth / PIXEL) : FALLBACK.w
    const h = box && box.clientHeight > 0 ? Math.ceil(box.clientHeight / PIXEL) : FALLBACK.h
    el.width = w
    el.height = h
    const ctx = el.getContext('2d')
    if (!ctx) return
    const show: Show = createShow(seed, w, h, calm)
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of showPixels(show)) {
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = p.color
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }
      ctx.globalAlpha = 1
    }
    if (still) {
      // Reduced motion: one frame, the show a moment in.
      stepShow(show, calm ? 600 : 1400)
      draw()
      return
    }
    let raf = 0
    let last: number | undefined
    const frame = (now: number) => {
      // About 15 steps a second keeps the pixels chunky and the work small.
      if (last === undefined || now - last >= 66) {
        stepShow(show, last === undefined ? 16 : Math.min(200, now - last))
        last = now
        draw()
      }
      if (!showIsOver(show)) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [seed, calm, still])

  const gems = `${formatNumber(summary.collected, locale)}/${formatNumber(summary.total, locale)}`
  return (
    <div className={`summary ${calm ? 'calm' : ''}`} data-testid="complete" data-kind={summary.kind} data-motion={still ? 'still' : 'live'}>
      <div className="summary-sky" aria-hidden="true">
        <canvas ref={canvas} className="summary-canvas" data-testid="summary-canvas" />
      </div>
      <div ref={panel} className="summary-box" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className={`summary-hero ${still || calm ? '' : 'hop'}`} role="img" aria-label={t('summary.hero')} data-testid="summary-hero">
          <PixelSvg art={walker} size={48} />
        </span>
        <span className={`summary-ghost ${still || calm ? '' : 'spin'}`} role="img" aria-label={t('summary.ghost')} data-testid="summary-ghost">
          <PixelSvg art={calm ? GHOST_FLOAT[0]! : GHOST_HAPPY} size={48} />
          {!calm && !still && (
            <>
              <i className="spark s1" aria-hidden="true" />
              <i className="spark s2" aria-hidden="true" />
              <i className="spark s3" aria-hidden="true" />
            </>
          )}
        </span>
        {!calm && (
          <p className="summary-lead" data-testid="summary-ghost-say">
            {t('ghost.finish')}
          </p>
        )}
        <h2 id={titleId}>{t(calm ? 'summary.title.paused' : 'summary.title.complete')}</h2>
        <p className="summary-lead">{t(calm ? 'summary.lead.paused' : 'summary.lead.complete')}</p>
        <div className="summary-title" data-testid="summary-title">
          <span className="summary-earned">{t('summary.earned')}</span>
          <strong>{t(`summary.t.${summary.title}`)}</strong>
        </div>
        <dl className="summary-stats">
          <div>
            <dt>{t('summary.distance')}</dt>
            <dd data-testid="summary-distance">{formatDistance(summary.walkedM, locale)}</dd>
          </div>
          <div>
            <dt>{t('summary.steps')}</dt>
            <dd data-testid="summary-steps">{formatNumber(summary.steps, locale)}</dd>
          </div>
          <div>
            <dt>{t('summary.time')}</dt>
            <dd data-testid="summary-time">{formatDuration(summary.elapsedMs)}</dd>
          </div>
          <div>
            <dt>{t('summary.pace')}</dt>
            <dd data-testid="summary-pace">
              {formatPace(summary.paceMinPerKm)}
              <small>{t('quest.paceUnit')}</small>
            </dd>
          </div>
          <div className="wide">
            <dt>{t('summary.gems')}</dt>
            <dd data-testid="summary-gems">{gems}</dd>
          </div>
        </dl>
        <div className="summary-buttons">
          <button type="button" className="pix-btn primary" data-autofocus data-testid="summary-back" onClick={onBack}>
            {t('summary.back')}
          </button>
          <button type="button" className="pix-btn" data-testid="summary-new" onClick={onNew}>
            {t('summary.new')}
          </button>
        </div>
      </div>
    </div>
  )
}
