/**
 * Tiny square-wave blips as placeholders for the Phase 3 chiptune. The
 * AudioContext is created on the first user gesture (browsers require it).
 */
let ctx: AudioContext | undefined

export function unlockAudio(): void {
  if (typeof window === 'undefined') return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  ctx ??= new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
}

/** Notes as [frequency Hz, start s, length s]. */
export type Note = [number, number, number]

export const PICKUP: Note[] = [
  [988, 0, 0.07],
  [1319, 0.07, 0.12],
]
export const FANFARE: Note[] = [
  [523, 0, 0.12],
  [659, 0.12, 0.12],
  [784, 0.24, 0.12],
  [1047, 0.36, 0.36],
  [784, 0.76, 0.1],
  [1047, 0.86, 0.5],
]

export function play(notes: Note[], volume = 0.08): void {
  if (!ctx) return
  const t0 = ctx.currentTime + 0.01
  for (const [freq, start, len] of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(volume, t0 + start)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0 + start)
    osc.stop(t0 + start + len + 0.02)
  }
}
