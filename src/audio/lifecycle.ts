/**
 * Browser plumbing for the AudioContext lifecycle (no audio is made here):
 * unlocking on the first tap, and recovering after interruptions.
 *
 * - iOS and Chrome only allow audio to start inside a user gesture, so the
 *   engine creates its context in a tap (`unlock`) or waits for the next one (`armOnGesture`).
 * - A phone call, Siri, locking the screen or a background tab can suspend or
 *   interrupt the context (Safari reports "interrupted"); it is resumed on the
 *   next tap, key press, when the page becomes visible, on `pageshow` and on focus.
 */

type Win = Window & typeof globalThis

const GESTURES = ['pointerup', 'touchend', 'keydown', 'click'] as const

/** Run `callback` once, on the next tap or key press anywhere. Returns a function that cancels it. */
export function armOnGesture(win: Win, callback: () => void): () => void {
  const doc = win.document
  const cancel = () => {
    for (const type of GESTURES) doc.removeEventListener(type, once, true)
  }
  const once = () => {
    cancel()
    callback()
  }
  for (const type of GESTURES) doc.addEventListener(type, once, true)
  return cancel
}

/** Call `resume` on every sign that the user is back (tap, key, visible, pageshow, focus). Installed once per page. */
export function installRecovery(win: Win, resume: () => void): void {
  for (const type of GESTURES) win.document.addEventListener(type, resume, { capture: true, passive: true })
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'visible') resume()
  })
  win.addEventListener('pageshow', resume)
  win.addEventListener('focus', resume)
}

/**
 * iOS: the "ambient" audio session mixes with the user's own music or podcast instead of
 * stopping it, and follows the ringer/silent switch (silent mode mutes the game, like other games).
 */
export function configureAudioSession(win: Win): void {
  const nav = win.navigator as unknown as { audioSession?: { type: string } } | undefined
  try {
    if (nav?.audioSession) nav.audioSession.type = 'ambient'
  } catch {
    // Not supported: keep the default.
  }
}

/** Old iOS only unlocks output when a sound is started inside the gesture: one silent sample. */
export function playSilentUnlock(ctx: AudioContext): void {
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate)
    const s = ctx.createBufferSource()
    s.buffer = b
    s.connect(ctx.destination)
    s.start()
  } catch {
    // ignore
  }
}
