type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean; addEventListener?: (type: 'release', cb: () => void) => void }
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> }

export type WakeLockHandle = { active(): boolean; release(): void }

/**
 * Keep the screen on while a quest runs (Screen Wake Lock API). Browsers drop
 * the lock when the tab is hidden, so it is re-acquired when it comes back.
 */
export function keepScreenOn(
  wakeLock: WakeLockLike | undefined = typeof navigator !== 'undefined' && 'wakeLock' in navigator ? (navigator as unknown as { wakeLock: WakeLockLike }).wakeLock : undefined,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | undefined = typeof document === 'undefined' ? undefined : document,
): WakeLockHandle {
  let sentinel: WakeLockSentinelLike | undefined
  let stopped = false
  const acquire = async () => {
    if (!wakeLock || stopped) return
    try {
      sentinel = await wakeLock.request('screen')
      if (stopped) void sentinel.release()
    } catch {
      sentinel = undefined // battery saver or not allowed; tracking still works while the screen is on
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
      void sentinel?.release()
      sentinel = undefined
    },
  }
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}
