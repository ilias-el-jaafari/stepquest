import { describe, expect, it } from 'vitest'
import { applyOps, fadeTo, kickEnvelope, noiseHitEnvelope, rampTo, sfxEnvelope, toneEnvelope, valueAt, type AutoOp, type ParamLike } from './automation.ts'

/** Records the calls made on a parameter. */
function recorder(value = 1) {
  const calls: string[] = []
  const param: ParamLike = {
    value,
    setValueAtTime: (v, t) => calls.push(`set ${v} ${t}`),
    linearRampToValueAtTime: (v, t) => calls.push(`linear ${v} ${t}`),
    exponentialRampToValueAtTime: (v, t) => calls.push(`exp ${v} ${t}`),
    setTargetAtTime: (v, t, tc) => calls.push(`target ${v} ${t} ${tc}`),
    cancelScheduledValues: (t) => calls.push(`cancel ${t}`),
  }
  return { param, calls }
}

describe('automation helpers', () => {
  it('B13: rampTo pins the present value before gliding, so Firefox and Safari do not jump', () => {
    const { param, calls } = recorder(0.4)
    rampTo(param, 1, 2, 0.05)
    expect(calls).toEqual(['cancel 2', 'set 0.4 2', 'target 1 2 0.05'])
  })

  it('uses cancelAndHoldAtTime where the browser has it', () => {
    const { param, calls } = recorder()
    param.cancelAndHoldAtTime = (t) => calls.push(`hold ${t}`)
    rampTo(param, 0, 1, 0.1)
    expect(calls).toEqual(['hold 1', 'target 0 1 0.1'])
  })

  it('fades linearly from the present value', () => {
    const { param, calls } = recorder(0.7)
    fadeTo(param, 0, 3, 0.015)
    expect(calls).toEqual(['cancel 3', 'set 0.7 3', 'linear 0 3.015'])
  })

  it('applies every kind of operation in order', () => {
    const { param, calls } = recorder()
    const ops: AutoOp[] = [
      { kind: 'set', value: 0, time: 1 },
      { kind: 'linear', value: 1, time: 2 },
      { kind: 'exp', value: 0.5, time: 3 },
      { kind: 'target', value: 0, time: 4, tc: 0.1 },
    ]
    applyOps(param, ops)
    expect(calls).toEqual(['set 0 1', 'linear 1 2', 'exp 0.5 3', 'target 0 4 0.1'])
  })
})

describe('B23: envelopes start and end at zero', () => {
  const cases: [string, AutoOp[], number, number][] = [
    ['tone', toneEnvelope(0.11, 10, 10.3), 10, 10.3 + 0.08],
    ['short tone', toneEnvelope(0.2, 5, 5.05), 5, 5.05 + 0.08],
    ['kick', kickEnvelope(3), 3, 3.16],
    ['snare', noiseHitEnvelope(0.14, 3, 0.12), 3, 3.14],
    ['hat', noiseHitEnvelope(0.05, 3, 0.035), 3, 3.055],
    ['effect note', sfxEnvelope(0.22, 1, 1.5), 1, 1.52],
    ['click', sfxEnvelope(0.066, 1, 1.022), 1, 1.042],
  ]
  for (const [name, ops, start, stop] of cases) {
    it(name, () => {
      expect(valueAt(ops, start - 0.5, 1)).toBe(1) // before: untouched
      expect(valueAt(ops, start)).toBe(0)
      expect(valueAt(ops, stop)).toBeLessThan(1e-3)
      expect(ops[ops.length - 1]!.value).toBe(0)
      for (let t = start; t <= stop; t += 0.001) expect(valueAt(ops, t)).toBeGreaterThanOrEqual(0)
    })
  }

  it('the tone envelope rises to its level and decays to 60 % of it', () => {
    const ops = toneEnvelope(0.2, 0, 1)
    expect(valueAt(ops, 0.005)).toBeCloseTo(0.2)
    expect(valueAt(ops, 0.5)).toBeCloseTo(0.12, 2)
    expect(valueAt(ops, 0.999)).toBeLessThan(0.02)
  })
})
