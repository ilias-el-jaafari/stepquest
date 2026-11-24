import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_AREA } from '../osm/demoArea.ts'
import type { PlanResult } from '../routing/planner.ts'
import type { SafePlan } from '../routing/safePlanner.ts'
import { TABS } from '../ui/tabs.ts'
import { appReducer, initialAppState, type AppAction, type AppState } from './appState.ts'

beforeEach(() => localStorage.clear())

const fakeResult = { ok: false, reason: 'noMatch' } as unknown as PlanResult
const fakePlan = { result: fakeResult } as unknown as SafePlan
const p = { lat: 39.49, lon: -0.39 }
const box = { south: 39.4, west: -0.4, north: 39.5, east: -0.3 }

const latLon = fc.record({ lat: fc.double({ min: 39, max: 40, noNaN: true }), lon: fc.double({ min: -1, max: 0, noNaN: true }) })

/** Actions that can happen at any time, with the plan token chosen by the test run (valid or not). */
const action: fc.Arbitrary<AppAction> = fc.oneof(
  fc.constantFrom(...TABS).map((tab) => ({ type: 'tab', tab }) as AppAction),
  fc.boolean().map((open) => ({ type: 'intro', open }) as AppAction),
  fc.integer({ min: 100, max: 60_000 }).map((targetSteps) => ({ type: 'settings', patch: { targetSteps } }) as AppAction),
  fc.constantFrom('loop', 'oneway').map((mode) => ({ type: 'mode', mode }) as AppAction),
  fc.constantFrom('start', 'end').map((which) => ({ type: 'place', which }) as AppAction),
  latLon.map((q) => ({ type: 'point', p: q }) as AppAction),
  fc.option(fc.constantFrom('Calle A', 'Calle B'), { nil: undefined }).map((name) => ({ type: 'pickStreet', name }) as AppAction),
  fc.boolean().map((on) => ({ type: 'pickMode', on }) as AppAction),
  fc.constant({ type: 'pickCancel' } as AppAction),
  fc.record({ token: fc.integer({ min: 0, max: 12 }), seed: fc.integer({ min: 0, max: 5 }) }).map((a) => ({ type: 'planStart', ...a }) as AppAction),
  fc.integer({ min: 0, max: 12 }).map((token) => ({ type: 'planDone', token, plan: fakePlan }) as AppAction),
  fc.integer({ min: 0, max: 12 }).map((token) => ({ type: 'planFailed', token }) as AppAction),
  fc.integer({ min: 0, max: 12 }).map((token) => ({ type: 'planCancelled', token }) as AppAction),
  fc.constant({ type: 'togglePlanner' } as AppAction),
  latLon.map((q) => ({ type: 'located', p: q }) as AppAction),
  latLon.map((q) => ({ type: 'areaLoaded', box, at: q }) as AppAction),
  fc.constant({ type: 'demo' } as AppAction),
  fc.constant({ type: 'resetPoints' } as AppAction),
  fc.array(fc.constantFrom('Calle A', 'Calle B', 'Calle C'), { maxLength: 3 }).map((list) => ({ type: 'avoid', list }) as AppAction),
)

const run = (actions: AppAction[], from = initialAppState()) => actions.reduce(appReducer, from)

describe('app state reducer', () => {
  it('starts on the map tab with the demo points and nothing planned', () => {
    const s = initialAppState()
    expect(s.tab).toBe('map')
    expect(s.start).toEqual(DEMO_AREA.defaultStart)
    expect(s.result).toBeUndefined()
    expect(s.plan.status).toBe('idle')
  })

  it('only one planning request runs at a time', () => {
    const s1 = appReducer(initialAppState(), { type: 'planStart', token: 1, seed: 0 })
    const s2 = appReducer(s1, { type: 'planStart', token: 2, seed: 1 })
    expect(s2).toBe(s1)
  })

  it('applies an answer for the current request and drops one for an older request', () => {
    const s1 = appReducer(initialAppState(), { type: 'planStart', token: 1, seed: 0 })
    const changed = appReducer(s1, { type: 'point', p })
    expect(changed.plan.status).toBe('idle')
    const late = appReducer(changed, { type: 'planDone', token: 1, plan: fakePlan })
    expect(late).toBe(changed)
    expect(late.result).toBeUndefined()
    const done = appReducer(s1, { type: 'planDone', token: 1, plan: fakePlan })
    expect(done.result).toBe(fakeResult)
    expect(done.plan.status).toBe('idle')
  })

  it('marks a failed request, and clears the failure when an input changes', () => {
    const s1 = appReducer(initialAppState(), { type: 'planStart', token: 1, seed: 0 })
    const failed = appReducer(s1, { type: 'planFailed', token: 1 })
    expect(failed.plan.status).toBe('failed')
    expect(appReducer(failed, { type: 'mode', mode: 'oneway' }).plan.status).toBe('idle')
  })

  it('does not clear the route when a setting is set to the value it already has', () => {
    const s = { ...initialAppState(), result: fakeResult }
    expect(appReducer(s, { type: 'settings', patch: { targetSteps: s.settings.targetSteps } })).toBe(s)
    expect(appReducer(s, { type: 'mode', mode: s.settings.mode })).toBe(s)
  })

  it('picking a street adds it, leaves picking mode and shows the Bag', () => {
    const s = appReducer({ ...initialAppState(), avoid: [], pickingAvoid: true }, { type: 'pickStreet', name: 'Calle Mayor' })
    expect(s).toMatchObject({ avoid: ['Calle Mayor'], pickingAvoid: false, tab: 'bag', pickNote: { ok: true, name: 'Calle Mayor' } })
    const miss = appReducer({ ...initialAppState(), pickingAvoid: true }, { type: 'pickStreet', name: undefined })
    expect(miss.pickingAvoid).toBe(true)
    expect(miss.pickNote).toEqual({ ok: false })
  })

  describe('properties (P-A1 to P-A4)', () => {
    const seq = fc.array(action, { maxLength: 40 })
    const opts = { seed: 20261204, numRuns: 300 }

    it('P-A1: a route never outlives a change of its inputs', () => {
      fc.assert(
        fc.property(seq, action, (actions, last) => {
          const before = run(actions)
          const after = appReducer(before, last)
          const inputsChanged = after.start !== before.start || after.end !== before.end || after.settings !== before.settings || after.avoid !== before.avoid
          if (inputsChanged) expect(after.result).toBeUndefined()
        }),
        opts,
      )
    })

    it('P-A2: a request is running only after a start, and the running request keeps its token', () => {
      fc.assert(
        fc.property(seq, (actions) => {
          let s = initialAppState()
          for (const a of actions) {
            const next = appReducer(s, a)
            if (next.plan.status === 'running' && s.plan.status !== 'running') expect(a.type).toBe('planStart')
            if (next.plan.status === 'running' && s.plan.status === 'running') expect(next.plan.token).toBe(s.plan.token)
            s = next
          }
        }),
        opts,
      )
    })

    it('P-A3: an answer with a token other than the current one changes nothing', () => {
      fc.assert(
        fc.property(seq, fc.integer({ min: 0, max: 12 }), (actions, token) => {
          const s = run(actions)
          fc.pre(token !== s.plan.token)
          for (const a of [{ type: 'planDone', token, plan: fakePlan }, { type: 'planFailed', token }, { type: 'planCancelled', token }] as AppAction[]) expect(appReducer(s, a)).toBe(s)
        }),
        opts,
      )
    })

    it('P-A4: the state stays valid: a real tab, a bounded avoid list, an end point only where one was set', () => {
      fc.assert(
        fc.property(seq, (actions) => {
          const s: AppState = run(actions)
          expect(TABS).toContain(s.tab)
          expect(s.avoid.length).toBeLessThanOrEqual(50)
          expect(['start', 'end']).toContain(s.placing)
        }),
        opts,
      )
    })
  })
})

describe('planning that always answers (routing requirement 12)', () => {
  const running = () => appReducer(initialAppState(), { type: 'planStart', token: 1, seed: 0 })

  it('a plan starts busy in the route phase and takes progress while the streets load', () => {
    const s = running()
    expect(s.plan).toMatchObject({ status: 'running', phase: 'route' })
    const loading = appReducer(s, { type: 'planProgress', token: 1, phase: 'streets', progress: { done: 3, total: 9 } })
    expect(loading.plan).toMatchObject({ phase: 'streets', progress: { done: 3, total: 9 } })
    expect(appReducer(s, { type: 'planProgress', token: 7, phase: 'streets' })).toBe(s)
  })

  it('a failure keeps its reason, and the next plan starts clean', () => {
    const failed = appReducer(running(), { type: 'planFailed', token: 1, error: 'timeout' })
    expect(failed.plan).toMatchObject({ status: 'failed', error: 'timeout' })
    const again = appReducer(failed, { type: 'planStart', token: 2, seed: 0 })
    expect(again.plan.status).toBe('running')
    expect(again.plan.error).toBeUndefined()
    expect(appReducer(running(), { type: 'planFailed', token: 1 }).plan.error).toBe('failed')
  })

  it('A → B makes the next tap the finish; a loop makes it the start', () => {
    const s = appReducer(initialAppState(), { type: 'mode', mode: 'oneway' })
    expect(s.placing).toBe('end')
    expect(appReducer(s, { type: 'mode', mode: 'loop' }).placing).toBe('start')
  })

  it('a located start forgets the demo finish and any finish no walk of the goal could reach', () => {
    const base = appReducer(initialAppState(), { type: 'mode', mode: 'oneway' })
    const far = appReducer(base, { type: 'located', p: { lat: 39.4697, lon: -0.3774 } })
    expect(far.start).toEqual({ lat: 39.4697, lon: -0.3774 })
    expect(far.end).toBeUndefined()
    const chosen = { lat: 39.4765, lon: -0.3705 }
    const kept = appReducer({ ...base, end: chosen }, { type: 'located', p: { lat: 39.4697, lon: -0.3774 } })
    expect(kept.end).toEqual(chosen)
    const tooFar = appReducer({ ...base, end: { lat: 39.9, lon: -0.1 } }, { type: 'located', p: { lat: 39.4697, lon: -0.3774 } })
    expect(tooFar.end).toBeUndefined()
  })

  it('a grown map is a live map and keeps the plan', () => {
    const s = appReducer(initialAppState(), { type: 'areaGrown', box })
    expect(s).toMatchObject({ isDemo: false, liveBox: box })
    const wider = appReducer(s, { type: 'areaGrown', box: { ...box, east: -0.2 } })
    expect(wider.liveBox?.east).toBe(-0.2)
    expect(wider.plan).toEqual(s.plan)
  })
})
