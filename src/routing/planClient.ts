import type { BBox } from '../geo/geo.ts'
import type { QuestState } from '../quest/quest.ts'
import type { ReroutePatch } from '../quest/reroute.ts'
import type { OsmData } from '../osm/types.ts'
import type { PlanRequest, PlanResponse, RequestKind } from './planProtocol.ts'
import type { RouteRequest } from './planner.ts'
import { PlanService, type PlanWorld } from './planService.ts'
import type { SafePlan } from './safePlanner.ts'
import type { SafetyOptions } from './safety.ts'
import type { WalkGraph } from './graph.ts'
import type { SafetyContext } from './safety.ts'

/** What the client needs of a loaded map; `graph` and `safety` are reused by the main-thread fallback. */
export type PlanSource = { data: OsmData; graph: WalkGraph; safety: SafetyContext }

export type Outcome<T> = { status: 'ok'; value: T; ms: number } | { status: 'stale' } | { status: 'error'; message: string }

/** Where requests run: a Web Worker, or the same service on the main thread. */
export type Backend = {
  post(msg: PlanRequest): void
  onmessage: ((answer: PlanResponse) => void) | undefined
  /** Share an already built map instead of sending its data (main-thread backend only). */
  adopt?(worldId: number, world: PlanWorld): void
  terminate(): void
}

/** Runs the service on the main thread, but in a later task so callers never block inside their own handler. */
export function inlineBackend(service = new PlanService()): Backend {
  let closed = false
  const backend: Backend = {
    onmessage: undefined,
    post(msg) {
      setTimeout(() => {
        if (closed) return
        const answer = service.handle(msg)
        if (answer) backend.onmessage?.(answer)
      }, 0)
    },
    adopt: (id, world) => service.adopt(id, world),
    terminate: () => {
      closed = true
    },
  }
  return backend
}

function workerBackend(): Backend {
  const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })
  const backend: Backend = {
    onmessage: undefined,
    post: (msg) => worker.postMessage(msg),
    terminate: () => worker.terminate(),
  }
  worker.onmessage = (e: MessageEvent<PlanResponse>) => backend.onmessage?.(e.data)
  worker.onerror = (e) => backend.onmessage?.({ type: 'error', id: undefined, message: e.message || 'worker failed' })
  return backend
}

type Job = { kind: RequestKind; id: number; msg: PlanRequest; resolve: (o: Outcome<never>) => void; stale: boolean }

/**
 * Main-thread side of the planning worker. One request runs at a time (a worker
 * cannot be interrupted); per kind only the newest request waiting is kept, and
 * an older one that is already running has its answer dropped: latest wins.
 */
export class PlanClient {
  private backend: Backend | undefined
  private nextId = 0
  private nextWorld = 0
  private readonly worlds = new WeakMap<OsmData, number>()
  private current: { id: number; source: PlanSource } | undefined
  private running: Job | undefined
  private readonly waiting: Partial<Record<RequestKind, Job>> = {}

  private create: () => Backend

  /** `create` picks the backend; by default a Web Worker where available, else the main thread. */
  constructor(create: () => Backend = defaultBackend) {
    this.create = create
  }

  plan(source: PlanSource, req: RouteRequest, area: BBox, opts: SafetyOptions): Promise<Outcome<SafePlan>> {
    const worldId = this.register(source)
    return this.submit<SafePlan>('plan', (id) => ({ type: 'plan', id, worldId, req, area, opts }))
  }

  reroute(source: PlanSource, state: QuestState, avoid: readonly string[], now: number): Promise<Outcome<ReroutePatch | undefined>> {
    const worldId = this.register(source)
    return this.submit<ReroutePatch | undefined>('reroute', (id) => ({ type: 'reroute', id, worldId, state, avoid: [...avoid], now }))
  }

  /** Stop the worker; the next request starts a new one. */
  dispose(): void {
    this.backend?.terminate()
    this.backend = undefined
    const jobs = [this.running, ...Object.values(this.waiting)]
    this.running = undefined
    for (const k of Object.keys(this.waiting) as RequestKind[]) delete this.waiting[k]
    for (const j of jobs) j?.resolve({ status: 'stale' })
    // The next backend knows no map: register again.
    this.current = undefined
  }

  /** The worker itself broke (it could not load, or crashed): run on the main thread from now on and retry. */
  private workerFailed(): void {
    const job = this.running
    const source = this.current?.source
    this.backend?.terminate()
    this.backend = undefined
    this.current = undefined
    this.create = () => inlineBackend()
    this.running = undefined
    if (job && source) {
      this.register(source)
      this.running = job
      this.connect().post(job.msg)
    } else job?.resolve({ status: 'error', message: 'worker failed' })
    this.pump()
  }

  private connect(): Backend {
    if (!this.backend) {
      const backend = this.create()
      backend.onmessage = (a) => this.answer(a)
      this.backend = backend
    }
    return this.backend
  }

  /** Send a map to the backend once; later requests only carry its id. */
  private register(source: PlanSource): number {
    const backend = this.connect()
    const known = this.worlds.get(source.data)
    if (known !== undefined && this.current?.id === known) return known
    if (this.current) backend.post({ type: 'drop', worldId: this.current.id })
    const id = known ?? ++this.nextWorld
    this.worlds.set(source.data, id)
    this.current = { id, source }
    if (backend.adopt) backend.adopt(id, { data: source.data, graph: source.graph, ctx: source.safety })
    else backend.post({ type: 'world', worldId: id, data: source.data })
    return id
  }

  private submit<T>(kind: RequestKind, build: (id: number) => PlanRequest): Promise<Outcome<T>> {
    return new Promise((resolve) => {
      const id = ++this.nextId
      this.waiting[kind]?.resolve({ status: 'stale' })
      if (this.running?.kind === kind) this.running.stale = true
      this.waiting[kind] = { kind, id, msg: build(id), resolve: resolve as Job['resolve'], stale: false }
      this.pump()
    })
  }

  private pump(): void {
    if (this.running) return
    const job = this.waiting.reroute ?? this.waiting.plan
    if (!job) return
    delete this.waiting[job.kind]
    this.running = job
    this.connect().post(job.msg)
  }

  private answer(a: PlanResponse): void {
    if (a.type === 'ready') return
    const job = this.running
    if (a.type === 'error' && a.id === undefined) return this.workerFailed()
    if (!job || (a.id !== undefined && a.id !== job.id)) return
    this.running = undefined
    if (a.type === 'error') job.resolve({ status: 'error', message: a.message })
    else if (job.stale) job.resolve({ status: 'stale' })
    else job.resolve({ status: 'ok', value: (a.type === 'plan' ? a.plan : a.patch) as never, ms: a.ms })
    this.pump()
  }
}

function defaultBackend(): Backend {
  if (typeof Worker !== 'undefined') {
    try {
      return workerBackend()
    } catch {
      // Blocked or unsupported (module workers, file:// pages): plan on the main thread.
    }
  }
  return inlineBackend()
}
