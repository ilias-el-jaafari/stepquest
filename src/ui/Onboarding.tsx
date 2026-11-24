import { useId, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.ts'
import type { PlainKey } from '../i18n/en.ts'
import { LogoMark } from './Logo.tsx'
import { PixelSvg } from './PixelIcons.tsx'
import { ONBOARDING_ART } from './onboardingArt.ts'
import { useModal } from './useModal.ts'

export const ONBOARDING_STEPS = 3

const TITLES: readonly PlainKey[] = ['onboarding.1.title', 'onboarding.2.title', 'onboarding.3.title']
const BODIES: readonly PlainKey[] = ['onboarding.1.body', 'onboarding.2.body', 'onboarding.3.body']

type Props = {
  /** Called when the user starts or skips; the caller stores the "seen" flag. */
  onClose: () => void
}

/** First-run introduction: three screens, skippable at any moment. */
export function Onboarding({ onClose }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const last = step === ONBOARDING_STEPS - 1

  const next = () => (last ? onClose() : setStep((s) => s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))

  // Arrow keys and Enter work from anywhere on the page (a click on the backdrop moves focus out).
  // Enter on a button keeps its own click.
  useModal(panel, {
    onEscape: onClose,
    onKey: (e) => {
      const onButton = e.target instanceof HTMLElement && e.target.closest('button') !== null
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (!last) setStep((s) => s + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'Enter' && !onButton) {
        e.preventDefault()
        next()
      }
    },
  })

  return (
    <div className="onb-wrap" data-testid="onboarding">
      <div
        ref={panel}
        className="onb"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <p className="onb-step">{t('onboarding.step', { n: step + 1, total: ONBOARDING_STEPS })}</p>
        <div className="onb-art" aria-hidden="true">
          {step === 0 && <LogoMark size={48} className="onb-logo" />}
          <PixelSvg art={ONBOARDING_ART[step]!} size={128} className="onb-pic" />
        </div>
        <h2 className="onb-title" id={titleId}>
          {t(TITLES[step]!)}
        </h2>
        <p className="onb-body" id={bodyId}>
          {t(BODIES[step]!)}
        </p>
        <div className="onb-dots" aria-hidden="true">
          {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
            <span key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="onb-actions">
          <button type="button" className="pix-btn" data-testid="onb-skip" onClick={onClose}>
            {t('onboarding.skip')}
          </button>
          {step > 0 && (
            <button type="button" className="pix-btn" data-testid="onb-back" onClick={back}>
              {t('onboarding.back')}
            </button>
          )}
          <button type="button" className="pix-btn primary" data-testid="onb-next" onClick={next}>
            {t(last ? 'onboarding.start' : 'onboarding.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
