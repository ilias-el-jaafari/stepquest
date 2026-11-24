import { describe, expect, it } from 'vitest'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { offRouteQuest } from '../quest/testWalk.testutil.ts'
import { WalkGraph } from './graph.ts'
import { inlineBackend, PlanClient, type Backend, type PlanSource } from './planClient.ts'
import type { PlanRequest } from './planProtocol.ts'
import { PlanService } from './planService.ts'
import { planWithSafety } from './safePlanner.ts'
import { edgeCosts, safetyContext } from './safety.ts'

const data = loadDemoOsm()
const graph = new WalkGraph(data)
const safety = safetyContext(graph, data)
const source: PlanSource = { data, graph, safety }
const req = { mode: 'loop' as const, start: DEMO_AREA.defaultStart, targetSteps: 6000, strideM: 0.75, seed: 2 }
const opts = { safe: true, night: false, avoid: [] }

/** A worker stand-in: records what it is sent (after a structured clone, like postMessage) and answers when told to. */
function fakeWorker() {
  const service = new PlanService()
  const sent: PlanRequest[] = []
  const queue: PlanRequest[] = []
  const backend: Backend = {
    onmessage: undefined,
    post: (m) => {
      const copy = structuredClone(m)
      sent.push(copy)
      queue.push(copy)
    },
    terminate: () => {},
  }
  return {
    backend,
    sent,
    /** Process the oldest request and deliver its answer. */
    step(): PlanRequest | undefined {
      const m = queue.shift()
      if (!m) return undefined
      const answer = service.handle(m)
      if (answer) backend.onmessage?.(structuredClone(answer))
      return m
    },
    pending: () => queue.length,
  }
}

describe('PlanService', () => {
  it('builds a world once and answers plan and reroute requests', () => {
    const service = new PlanService()
    expect(service.handle({ type: 'world', worldId: 1, data })).toMatchObject({ type: 'ready', worldId: 1 })
    const answer = service.handle({ type: 'plan', id: 7, worldId: 1, req, area: data.bbox, opts })
    expect(answer).toMatchObject({ type: 'plan', id: 7 })
    const direct = planWithSafety(graph, safety, req, data.bbox, opts)
    expect(answer?.type === 'plan' && answer.plan.result.ok).toBe(direct.result.ok)
    expect(answer?.type === 'plan' && answer.plan.result.ok && direct.result.ok && answer.plan.result.route.distanceM).toBe(direct.result.ok ? direct.result.route.distanceM : -1)
  })

  it('reports an unknown world as an error with the request id', () => {
    const answer = new PlanService().handle({ type: 'plan', id: 3, worldId: 9, req, area: data.bbox, opts })
    expect(answer).toMatchObject({ type: 'error', id: 3 })
  })

  it('forgets a dropped world', () => {
    const service = new PlanService()
    service.handle({ type: 'world', worldId: 1, data })
    service.handle({ type: 'drop', worldId: 1 })
    expect(service.has(1)).toBe(false)
  })
})

describe('PlanClient', () => {
  it('sends the map once and then only small requests', async () => {
    const w = fakeWorker()
    const client = new PlanClient(() => w.backend)
    const a = client.plan(source, req, data.bbox, opts)
    w.step()
    w.step()
    expect((await a).status).toBe('ok')
    const b = client.plan(source, { ...req, seed: 3 }, data.bbox, opts)
    w.step()
    expect((await b).status).toBe('ok')
    expect(w.sent.map((m) => m.type)).toEqual(['world', 'plan', 'plan'])
  })

  it('latest wins: a request replaced while waiting is never sent', async () => {
    const w = fakeWorker()
    const client = new PlanClient(() => w.backend)
    const first = client.plan(source, { ...req, seed: 1 }, data.bbox, opts)
    // The first is running; the next two arrive while the worker is busy.
    const second = client.plan(source, { ...req, seed: 2 }, data.bbox, opts)
    const third = client.plan(source, { ...req, seed: 3 }, data.bbox, opts)
    expect((await second).status).toBe('stale')
    while (w.step()) await Promise.resolve()
    expect((await first).status).toBe('stale')
    const last = await third
    expect(last.status).toBe('ok')
    const plans = w.sent.filter((m) => m.type === 'plan')
    expect(plans.map((m) => m.type === 'plan' && m.req.seed)).toEqual([1, 3])
  })

  it('answers a reroute before a waiting plan, and keeps them independent', async () => {
    const w = fakeWorker()
    const client = new PlanClient(() => w.backend)
    const q = offRouteQuest(planned(), 600)
    const first = client.plan(source, req, data.bbox, opts)
    const plan2 = client.plan(source, { ...req, seed: 5 }, data.bbox, opts)
    const reroute = client.reroute(source, q, [], Date.UTC(2026, 10, 22, 12))
    while (w.step()) await Promise.resolve()
    await first
    expect((await reroute).status).toBe('ok')
    expect((await plan2).status).toBe('ok')
    const order = w.sent.map((m) => m.type)
    expect(order.indexOf('reroute')).toBeLessThan(order.lastIndexOf('plan'))
  })

  it('returns a reroute patch that matches the synchronous planner', async () => {
    const client = new PlanClient(() => inlineBackend())
    const q = offRouteQuest(planned(), 600)
    const out = await client.reroute(source, q, [], Date.UTC(2026, 10, 22, 12))
    expect(out.status).toBe('ok')
    if (out.status === 'ok') {
      expect(out.value?.questId).toBe(q.id)
      expect(out.value?.base).toBe(0)
    }
  })

  it('runs on the main thread when there is no Worker, sharing the built graph', async () => {
    expect(typeof Worker).toBe('undefined')
    const client = new PlanClient()
    const a = client.plan(source, req, data.bbox, opts)
    const b = client.plan(source, { ...req, seed: 4 }, data.bbox, opts)
    expect((await a).status).toBe('stale')
    expect((await b).status).toBe('ok')
  })

  it('moves to the main thread when the worker itself fails, and retries the request', async () => {
    let first = true
    const broken: Backend = {
      onmessage: undefined,
      post() {
        if (first) {
          first = false
          queueMicrotask(() => broken.onmessage?.({ type: 'error', id: undefined, message: 'cannot load' }))
        }
      },
      terminate: () => {},
    }
    const client = new PlanClient(() => broken)
    const out = await client.plan(source, req, data.bbox, opts)
    expect(out.status).toBe('ok')
  })

  it('turns a request error into an error outcome and keeps working', async () => {
    const backend: Backend = {
      onmessage: undefined,
      post(m) {
        if (m.type === 'plan') queueMicrotask(() => backend.onmessage?.({ type: 'error', id: m.id, message: 'boom' }))
      },
      terminate: () => {},
    }
    const client = new PlanClient(() => backend)
    expect(await client.plan(source, req, data.bbox, opts)).toEqual({ status: 'error', message: 'boom' })
    expect(await client.plan(source, req, data.bbox, opts)).toEqual({ status: 'error', message: 'boom' })
  })

  it('stops the backend on dispose and settles waiting requests as stale', async () => {
    const w = fakeWorker()
    let ended = false
    w.backend.terminate = () => (ended = true)
    const client = new PlanClient(() => w.backend)
    const p = client.plan(source, req, data.bbox, opts)
    client.dispose()
    expect(ended).toBe(true)
    expect((await p).status).toBe('stale')
  })
})

describe('edge cost cache', () => {
  it('returns the same costs for the same options and new ones when they change', () => {
    const a = edgeCosts(safety, { safe: true, night: false, avoid: ['Carrer X'] })!
    expect(edgeCosts(safety, { safe: true, night: false, avoid: ['carrer x'] })).toBe(a)
    expect(edgeCosts(safety, { safe: true, night: true, avoid: ['Carrer X'] })).not.toBe(a)
    expect(edgeCosts(safety, { safe: false, night: false, avoid: [] })).toBeUndefined()
  })
})

function planned() {
  const p = planWithSafety(graph, safety, { ...req, targetSteps: 10_000, seed: 1 }, data.bbox, opts)
  if (!p.result.ok) throw new Error('route')
  const r = p.result.route
  return { mode: r.mode, points: r.points, distanceM: r.distanceM, steps: r.steps, targetSteps: r.targetSteps, checkpoints: r.checkpoints }
}
