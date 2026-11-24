import { formatNumber } from '../i18n/format.ts'
import { useI18n } from '../i18n/index.ts'
import type { Sprite } from '../render/sprites.ts'
import { Logo } from './Logo.tsx'
import { PixelSvg } from './PixelIcons.tsx'

/** Title bar: logo, tagline, the walker and today's steps. */
export function AppHeader({ walker, todaySteps }: { walker: Sprite; todaySteps: number }) {
  const { t, locale } = useI18n()
  return (
    <header className="topbar">
      <div className="brand">
        <h1 className="logo">
          <Logo />
        </h1>
        <p className="tagline">{t('app.tagline')}</p>
      </div>
      <div className="status-row">
        <span className="avatar" role="img" aria-label={t('header.avatar')}>
          <PixelSvg art={walker} size={30} />
        </span>
        <span className="steps-pill" data-testid="steps-today">
          <span className="steps-pill-label">{t('header.stepsToday')}:</span> <strong>{formatNumber(todaySteps, locale)}</strong>
        </span>
      </div>
    </header>
  )
}
