type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean; addEventListener?: (type: 'release', cb: () => void) => void }
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> }

export type WakeLockHandle = { active(): boolean; release(): void }

/**
 * Keep the screen on while a quest runs (Screen Wake Lock API). Browsers drop
 * the lock when the tab is hidden, so it is re-acquired when it comes back.
 * At most one lock is held or requested at a time; a request that resolves after
 * `release()` is released at once. `onChange` is told whenever the lock is gained or lost.
 */
export function keepScreenOn(
  wakeLock: WakeLockLike | undefined = typeof navigator !== 'undefined' && 'wakeLock' in navigator ? (navigator as unknown as { wakeLock: WakeLockLike }).wakeLock : undefined,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | undefined = typeof document === 'undefined' ? undefined : document,
  onChange?: (active: boolean) => void,
): WakeLockHandle {
  let sentinel: WakeLockSentinelLike | undefined
  let pending = false
  let stopped = false
  const acquire = async () => {
    if (!wakeLock || stopped || pending) return
    pending = true
    try {
      const got = await wakeLock.request('screen')
      if (stopped) {
        void got.release().catch(() => {})
        return
      }
      sentinel = got
      got.addEventListener?.('release', () => {
        if (sentinel !== got) return
        sentinel = undefined
        onChange?.(false)
      })
      onChange?.(true)
    } catch {
      sentinel = undefined // battery saver or not allowed; tracking still works while the screen is on
    } finally {
      pending = false
    }
  }
  const onVisible = () => {
    if (doc?.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire()
  }
  void acquire()
  doc?.addEventListener('visibilitychange', onVisible)
  return {
    active: () => !!sentinel && !sentinel.released,
    release: () => {
      stopped = true
      doc?.removeEventListener('visibilitychange', onVisible)
      const held = sentinel
      sentinel = undefined
      void held?.release().catch(() => {})
    },
  }
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}
