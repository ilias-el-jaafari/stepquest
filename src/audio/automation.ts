/**
 * Web Audio parameter automation, described as data so that it can be tested
 * without a browser. Every envelope here starts at zero gain and ends at zero
 * gain (no click when a note begins or ends), and `rampTo` changes a level from
 * whatever value the parameter has at that moment (no jump, no pop).
 */

export type AutoOp =
  | { kind: 'set' | 'linear' | 'exp'; value: number; time: number }
  | { kind: 'target'; value: number; time: number; tc: number }

/** The part of `AudioParam` used here. */
export type ParamLike = {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown
  cancelScheduledValues(time: number): unknown
  cancelAndHoldAtTime?(time: number): unknown
}

/** Schedule the operations on a parameter. */
export function applyOps(param: ParamLike, ops: readonly AutoOp[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'set':
        param.setValueAtTime(op.value, op.time)
        break
      case 'linear':
        param.linearRampToValueAtTime(op.value, op.time)
        break
      case 'exp':
        param.exponentialRampToValueAtTime(op.value, op.time)
        break
      case 'target':
        param.setTargetAtTime(op.value, op.time, op.tc)
        break
    }
  }
}

/** Drop what is scheduled from `time` on and keep the current value there. */
function holdAt(param: ParamLike, time: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time)
    return
  }
  // Without it, cancelling lets Firefox and Safari restart from the last value that was set: pin the present one.
  const now = param.value
  param.cancelScheduledValues(time)
  param.setValueAtTime(now, time)
}

/** Glide a level to a new value with a time constant (seconds), starting from where it is now. */
export function rampTo(param: ParamLike, value: number, time: number, tc: number): void {
  holdAt(param, time)
  param.setTargetAtTime(value, time, tc)
}

/** Linear fade to a value over `seconds`, starting from where the level is now. */
export function fadeTo(param: ParamLike, value: number, time: number, seconds: number): void {
  holdAt(param, time)
  param.linearRampToValueAtTime(value, time + seconds)
}

/** A melodic note: 5 ms attack, a soft decay to 60 %, a release 20 ms before its end, silence after. */
export function toneEnvelope(level: number, time: number, end: number): AutoOp[] {
  return [
    { kind: 'set', value: 0, time },
    { kind: 'linear', value: level, time: time + 0.005 },
    { kind: 'target', value: level * 0.6, time: time + 0.02, tc: 0.08 },
    { kind: 'target', value: 0, time: Math.max(time + 0.01, end - 0.02), tc: 0.01 },
    { kind: 'set', value: 0, time: end + 0.07 },
  ]
}

/** The bass drum: 2 ms attack, exponential decay, then zero. */
export function kickEnvelope(time: number, level = 0.32): AutoOp[] {
  return [
    { kind: 'set', value: 0, time },
    { kind: 'linear', value: level, time: time + 0.002 },
    { kind: 'exp', value: 0.001, time: time + 0.14 },
    { kind: 'linear', value: 0, time: time + 0.15 },
  ]
}

/** Snare and hi-hat noise hits: 1 ms attack, exponential decay over `len`, then zero. */
export function noiseHitEnvelope(level: number, time: number, len: number): AutoOp[] {
  return [
    { kind: 'set', value: 0, time },
    { kind: 'linear', value: level, time: time + 0.001 },
    { kind: 'exp', value: 0.001, time: time + len },
    { kind: 'linear', value: 0, time: time + len + 0.01 },
  ]
}

/** A sound-effect note: 4 ms attack, hold, 30 ms release to zero at `end`. */
export function sfxEnvelope(level: number, start: number, end: number): AutoOp[] {
  return [
    { kind: 'set', value: 0, time: start },
    { kind: 'linear', value: level, time: start + 0.004 },
    { kind: 'set', value: level, time: Math.max(start + 0.005, end - 0.03) },
    { kind: 'linear', value: 0, time: end },
  ]
}

/**
 * The value an envelope has at time `x` (the Web Audio rules for set, linear,
 * exponential and target events, for tests and tooling). `initial` is the value
 * before the first event.
 */
export function valueAt(ops: readonly AutoOp[], x: number, initial = 1): number {
  const sorted = [...ops].sort((a, b) => a.time - b.time)
  let t = -Infinity
  let v = initial
  let curve: Extract<AutoOp, { kind: 'target' }> | undefined
  const hold = (at: number) => (curve ? curve.value + (v - curve.value) * Math.exp(-(at - t) / curve.tc) : v)
  for (const op of sorted) {
    if (op.time > x) {
      if ((op.kind === 'linear' || op.kind === 'exp') && Number.isFinite(t)) {
        const start = v
        const frac = (x - t) / (op.time - t)
        if (op.kind === 'linear') return start + (op.value - start) * frac
        const s = Math.max(start, 1e-4)
        return s * (op.value / s) ** frac
      }
      return hold(x)
    }
    const before = hold(op.time)
    v = op.kind === 'target' ? before : op.value
    t = op.time
    curve = op.kind === 'target' ? op : undefined
  }
  return hold(x)
}
