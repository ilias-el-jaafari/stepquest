import { useId, useRef } from 'react'
import { useI18n } from '../i18n/index.ts'
import type { PlainKey } from '../i18n/en.ts'
import { useModal } from './useModal.ts'

type Props = {
  /** Text of the question (a plain key, so it can come from a table). */
  message: PlainKey
  yes: PlainKey
  no: PlainKey
  onYes: () => void
  onNo: () => void
  testId?: string
}

/** A retro yes / no question in the app's own style. The safe answer ("no") has focus first. */
export function ConfirmDialog({ message, yes, no, onYes, onNo, testId = 'confirm' }: Props) {
  const { t } = useI18n()
  const panel = useRef<HTMLDivElement>(null)
  const textId = useId()
  useModal(panel, { onEscape: onNo })
  return (
    <div className="confirm-wrap">
      <div ref={panel} className="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby={textId} tabIndex={-1} data-testid={testId}>
        <p id={textId}>{t(message)}</p>
        <div className="confirm-actions">
          <button type="button" className="pix-btn" data-autofocus data-testid="confirm-no" onClick={onNo}>
            {t(no)}
          </button>
          <button type="button" className="pix-btn danger" data-testid="confirm-yes" onClick={onYes}>
            {t(yes)}
          </button>
        </div>
      </div>
    </div>
  )
}
