import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

type Options = {
  /** Escape was pressed anywhere on the page. */
  onEscape?: () => void
  /** Any other key, also from anywhere (so a click on the backdrop does not break the keyboard). */
  onKey?: (e: KeyboardEvent) => void
}

/**
 * Focus handling every modal dialog needs: focus moves in on open (to the element marked
 * `data-autofocus`, else the panel), Tab and Shift+Tab stay inside, Escape closes, and
 * focus goes back to where it was when the dialog closes. Keys are read on the document, so
 * they still work after a click on the dimmed backdrop moved focus out of the panel.
 */
export function useModal(panel: RefObject<HTMLElement | null>, { onEscape, onKey }: Options = {}) {
  const escapeRef = useRef(onEscape)
  const keyRef = useRef(onKey)
  useEffect(() => {
    escapeRef.current = onEscape
    keyRef.current = onKey
  })

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const el = panel.current
    ;(el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus()

    const onDown = (e: KeyboardEvent) => {
      const root = panel.current
      if (!root) return
      if (e.key === 'Escape') {
        e.preventDefault()
        escapeRef.current?.()
      } else if (e.key === 'Tab') {
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        const inside = active instanceof Node && root.contains(active)
        if (!first || !last) {
          e.preventDefault()
          root.focus()
        } else if (!inside) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        } else if (e.shiftKey && (active === first || active === root)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      } else {
        keyRef.current?.(e)
      }
    }
    document.addEventListener('keydown', onDown)
    return () => {
      document.removeEventListener('keydown', onDown)
      if (before?.isConnected) before.focus()
    }
  }, [panel])
}
