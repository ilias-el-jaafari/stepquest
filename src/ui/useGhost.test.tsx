import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { destination } from '../geo/geo.ts'
import { audioEngine } from '../audio/engine.ts'
import { WARMUP_MS } from '../ghost/pacer.ts'
import type { Phase } from '../render/daylight.ts'
import { placeCheckpoints } from '../routing/checkpoints.ts'
import { createQuest, type QuestState } from '../quest/quest.ts'
import type { QuestRoute } from '../quest/types.ts'
import { useGhost } from './useGhost.ts'
import type { Pickup } from './useQuestRunner.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const origin = { lat: 39.4935, lon: -0.392 }
const points = Array.from({ length: 11 }, (_, i) => destination(origin, 90, i * 100))
const route: QuestRoute = { mode: 'oneway', points, distanceM: 1000, steps: 1333, targetSteps: 1333, checkpoints: placeCheckpoints(points, 4) }
const sim = (): QuestState => createQuest(route, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0, id: 'g', sim: { timeScale: 1, noiseM: 0 } })

let host: HTMLDivElement
let root: Root
let out: ReturnType<typeof useGhost> | undefined
let now = 0

function Probe(p: { quest: QuestState; pickup?: Pickup; phase: Phase }) {
  const g = useGhost({ quest: p.quest, pickup: p.pickup, phase: p.phase, seed: 3 })
  useEffect(() => {
    out = g
  })
  return null
}
const render = (props: Parameters<typeof Probe>[0]) => act(async () => root.render(<Probe {...props} />))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  host = document.createElement('div')
  root = createRoot(host)
  out = undefined
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const tick = async (ms: number) => {
  now += ms
  await act(async () => void vi.advanceTimersByTime(ms))
}

describe('useGhost', () => {
  it('gives a plan at the quest pace and a quiet status at first', async () => {
    await render({ quest: sim(), phase: 'day' })
    expect(out!.plan).toBeDefined()
    expect(out!.pace.kmh).toBe(5)
    expect(out!.status).toBe('warmup')
  })

  it('tells a hero who stands still that the ghost is waiting, and an on-pace hero that they keep up (no flicker)', async () => {
    const q = sim()
    await render({ quest: q, phase: 'day' })
    await tick(WARMUP_MS + 30_000)
    expect(out!.status).toBe('behind')
    // The hero catches up to the pace point.
    const pace = out!.pace.mps
    await render({ quest: { ...q, alongM: pace * ((WARMUP_MS + 30_000) / 1000) } , phase: 'day' })
    await tick(500)
    expect(out!.status).toBe('on')
  })

  it('comments on a gem, in a bubble that clears by itself', async () => {
    const q = sim()
    await render({ quest: q, phase: 'day' })
    await render({ quest: q, phase: 'day', pickup: { n: 1, point: points[3]!, index: 1, total: 4 } })
    expect(out!.say?.key).toMatch(/^ghost\.cp\./)
    await tick(10_000)
    expect(out!.say).toBeUndefined()
  })

  it('does the friendly scare once at dusk, then points to the lit way', async () => {
    const q = sim()
    await render({ quest: q, phase: 'day' })
    expect(out!.say).toBeUndefined()
    await render({ quest: q, phase: 'dusk' })
    expect(out!.say?.key).toBe('ghost.boo')
    expect(out!.say?.pose).toBe('boo')
    await tick(1600)
    expect(out!.say?.key).toBe('ghost.lit')
    await tick(10_000)
    await render({ quest: q, phase: 'night' })
    expect(out!.say).toBeUndefined()
  })

  it('plays the soft scare jingle once, with the scare', async () => {
    const play = vi.spyOn(audioEngine(), 'playSfx').mockImplementation(() => {})
    const q = sim()
    await render({ quest: q, phase: 'day' })
    expect(play).not.toHaveBeenCalled()
    await render({ quest: q, phase: 'dusk' })
    expect(play).toHaveBeenCalledWith('scare')
    await render({ quest: q, phase: 'night' })
    await render({ quest: q, phase: 'dusk' })
    expect(play.mock.calls.filter(([n]) => n === 'scare')).toHaveLength(1)
  })

  it('waits for the first fix of a real walk and stops at the finish', async () => {
    const real = { ...sim(), simulated: false, sim: undefined }
    await render({ quest: real, phase: 'day' })
    await tick(60_000)
    expect(out!.plan!.pausedAt).toBeDefined()
    await render({ quest: { ...real, lastFixAt: 1 }, phase: 'day' })
    expect(out!.plan!.pausedAt).toBeUndefined()
    await render({ quest: { ...real, lastFixAt: 2, finishedAt: 2 }, phase: 'day' })
    expect(out!.plan).toBeUndefined()
  })
})
