import { useEffect, type RefObject } from 'react'

/**
 * Closes a pop-up on Escape or a press outside it. After Escape, focus goes back to the
 * button that opened it when focus was inside the pop-up (it would otherwise fall to the page body).
 */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, opener: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const hadFocus = root.current?.contains(document.activeElement) ?? false
      close()
      if (hadFocus) opener.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, root, opener])
}
