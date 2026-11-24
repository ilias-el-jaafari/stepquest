import { useEffect, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n/index.ts'

export type DialogueKind = 'start' | 'pickup' | 'finish' | 'info'

type Props = {
  kind: DialogueKind
  lines: readonly string[]
  /** Called after the last line is read (tap) or the auto-close timer runs out. */
  onDone: () => void
  /** Close by itself this long after the last line is fully shown (hands-free walking). */
  autoCloseMs?: number
  /** Milliseconds per character for the typewriter; 0 shows text at once. */
  charMs?: number
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Classic RPG dialogue box: text types out, a blinking marker shows when a
 * line is complete, and a tap (or Enter / Space) skips the typing or moves
 * to the next line. Keyed by the parent per message, so state starts fresh.
 */
export function DialogueBox({ kind, lines, onDone, autoCloseMs, charMs = 28 }: Props) {
  const { t } = useI18n()
  const [line, setLine] = useState(0)
  const [shown, setShown] = useState(() => (charMs <= 0 || reducedMotion() ? Number.MAX_SAFE_INTEGER : 0))
  const text = lines[line] ?? ''
  const typing = shown < text.length
  const last = line >= lines.length - 1

  useEffect(() => {
    if (!typing) return
    const id = setTimeout(() => setShown((n) => n + 1), charMs)
    return () => clearTimeout(id)
  }, [typing, shown, charMs])

  useEffect(() => {
    if (typing || !last || !autoCloseMs) return
    const id = setTimeout(onDone, autoCloseMs)
    return () => clearTimeout(id)
  }, [typing, last, autoCloseMs, onDone])

  const advance = () => {
    if (typing) {
      setShown(Number.MAX_SAFE_INTEGER)
      return
    }
    if (last) {
      onDone()
      return
    }
    setLine((l) => l + 1)
    setShown(charMs <= 0 || reducedMotion() ? Number.MAX_SAFE_INTEGER : 0)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      advance()
    }
  }

  return (
    <>
      <div
        className="dialog"
        data-kind={kind}
        data-testid={`dialog-${kind}`}
        role="button"
        tabIndex={0}
        aria-label={`${text} — ${t(last ? 'dialog.close' : 'dialog.next')}`}
        onClick={advance}
        onKeyDown={onKey}
      >
        <p className="dialog-text" aria-hidden="true">
          {text.slice(0, shown)}
          {/* Reserve the full text's space so the box does not grow while typing. */}
          <span className="dialog-ghost">{text.slice(shown)}</span>
        </p>
        {!typing && <span className={`dialog-more ${last ? 'last' : ''}`} aria-hidden="true" />}
      </div>
      {/* Screen readers get each line whole and once; the letter-by-letter copy above is hidden from them. */}
      <p className="sr-only" role="status">
        {text}
      </p>
    </>
  )
}
