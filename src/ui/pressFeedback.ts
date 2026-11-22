/** What a press on a button gives back: a click on the effects channel and, on Android, a tiny buzz. */
export type FeedbackDeps = {
  playClick: () => void
  vibrate?: (ms: number) => boolean
  userAgent?: string
}

/** Things that count as a press: buttons, tabs, radios and the colour swatches. */
export const PRESSABLE = 'button:not(:disabled), [role="tab"], [role="radio"], summary'

const VIBRATE_MS = 8

/** Vibration only on Android (iOS ignores it, desktop has none) and only when the browser has it. */
export function canVibrate(nav: { userAgent?: string; vibrate?: unknown } | undefined): boolean {
  return !!nav && typeof nav.vibrate === 'function' && /Android/i.test(nav.userAgent ?? '')
}

export function pressFeedback(deps: FeedbackDeps): () => void {
  return () => {
    deps.playClick()
    if (deps.vibrate && /Android/i.test(deps.userAgent ?? '')) {
      try {
        deps.vibrate(VIBRATE_MS)
      } catch {
        // some browsers throw when vibration is blocked
      }
    }
  }
}

/**
 * Listen for presses anywhere in `root` and give feedback once per press.
 * Returns a function that stops listening.
 */
export function installPressFeedback(root: Pick<Document, 'addEventListener' | 'removeEventListener'>, deps: FeedbackDeps): () => void {
  const fire = pressFeedback(deps)
  const onPress = (e: Event) => {
    const target = e.target as Element | null
    if (target && typeof target.closest === 'function' && target.closest(PRESSABLE)) fire()
  }
  root.addEventListener('pointerdown', onPress, { passive: true })
  return () => root.removeEventListener('pointerdown', onPress)
}

/** The browser's vibrate, bound, when this device should buzz. */
export function deviceVibrate(): ((ms: number) => boolean) | undefined {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return nav && canVibrate(nav) ? (ms) => nav.vibrate(ms) : undefined
}
