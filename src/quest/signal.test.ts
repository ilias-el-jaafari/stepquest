import { describe, expect, it } from 'vitest'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { createQuest } from './quest.ts'
import { LOST_AFTER_MS, signalStatus, WEAK_AFTER_MS } from './signal.ts'

const points = [{ lat: 39.49, lon: -0.39 }, { lat: 39.491, lon: -0.39 }]
const base = createQuest({ mode: 'oneway', points, distanceM: 111, steps: 148, targetSteps: 148, checkpoints: placeCheckpoints(points, 1) }, { strideM: 0.75, area: { kind: 'demo' }, simulated: false, now: 0 })

describe('signal status (64.11)', () => {
  it('is ok before the first fix and with recent fixes', () => {
    expect(signalStatus(base, 100_000)).toBe('ok')
    expect(signalStatus({ ...base, lastFixAt: 90_000 }, 100_000)).toBe('ok')
  })
  it('is lost after 30 s without an accepted fix, except in the simulator', () => {
    expect(signalStatus({ ...base, lastFixAt: 0 }, LOST_AFTER_MS)).toBe('ok')
    expect(signalStatus({ ...base, lastFixAt: 0 }, LOST_AFTER_MS + 1)).toBe('lost')
    expect(signalStatus({ ...base, lastFixAt: 0, simulated: true }, 999_999)).toBe('ok')
  })
  it('is weak after 5 s of rejected fixes; lost wins over weak', () => {
    expect(signalStatus({ ...base, weakSince: 0 }, WEAK_AFTER_MS)).toBe('ok')
    expect(signalStatus({ ...base, weakSince: 0 }, WEAK_AFTER_MS + 1)).toBe('weak')
    expect(signalStatus({ ...base, weakSince: 0, lastFixAt: 0 }, LOST_AFTER_MS + 1)).toBe('lost')
  })
  it('shows nothing once finished', () => {
    expect(signalStatus({ ...base, finishedAt: 5, lastFixAt: 0, weakSince: 0 }, 999_999)).toBe('finished')
  })
})
