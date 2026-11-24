import { describe, expect, it, vi } from 'vitest'
import swSource from './sw.template.js?raw'
import { UpdateStore, type ContainerLike, type RegistrationLike, type WorkerLike } from './updateStore.ts'

function fakeWorker(state = 'installing') {
  const listeners: (() => void)[] = []
  const worker: WorkerLike & { state: string; fire: (s: string) => void; posted: unknown[] } = {
    state,
    posted: [],
    postMessage(m) {
      this.posted.push(m)
    },
    addEventListener: (_t, l) => void listeners.push(l),
    fire(s) {
      this.state = s
      listeners.forEach((l) => l())
    },
  }
  return worker
}

function fakeContainer(opts: { controller: boolean; waiting?: WorkerLike }) {
  const onRegistration: { updatefound?: () => void } = {}
  const onContainer: { controllerchange?: () => void } = {}
  const registration: RegistrationLike = {
    waiting: opts.waiting ?? null,
    installing: null,
    addEventListener: (_t, l) => void (onRegistration.updatefound = l),
  }
  const container: ContainerLike = {
    controller: opts.controller ? {} : null,
    register: async () => registration,
    addEventListener: (_t, l) => void (onContainer.controllerchange = l),
  }
  return { container, registration, onRegistration, onContainer }
}

describe('UpdateStore', () => {
  it('does not call the very first install an update', async () => {
    const store = new UpdateStore(() => {})
    const { container, registration, onRegistration } = fakeContainer({ controller: false })
    await store.attach(container, 'sw.js')
    const w = fakeWorker()
    registration.installing = w
    onRegistration.updatefound?.()
    w.fire('installed')
    expect(store.getSnapshot().updateReady).toBe(false)
  })

  it('offers an update when a new worker finishes installing under a running one, and applies it on request only', async () => {
    const reload = vi.fn()
    const store = new UpdateStore(reload)
    const seen = vi.fn()
    store.subscribe(seen)
    const { container, registration, onRegistration, onContainer } = fakeContainer({ controller: true })
    await store.attach(container, 'sw.js')
    const w = fakeWorker()
    registration.installing = w
    onRegistration.updatefound?.()
    w.fire('installed')
    expect(store.getSnapshot().updateReady).toBe(true)
    expect(seen).toHaveBeenCalled()
    // The page does not reload by itself when the worker takes over for another reason.
    onContainer.controllerchange?.()
    expect(reload).not.toHaveBeenCalled()
    store.apply()
    expect(w.posted).toEqual(['skip-waiting'])
    onContainer.controllerchange?.()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('finds an update that was already waiting when the page opened, and can hide the prompt', async () => {
    const store = new UpdateStore(() => {})
    const { container } = fakeContainer({ controller: true, waiting: fakeWorker('installed') })
    await store.attach(container, 'sw.js')
    expect(store.getSnapshot().updateReady).toBe(true)
    store.dismiss()
    expect(store.getSnapshot().updateReady).toBe(false)
  })
})

describe('service worker template', () => {
  type Listener = (e: unknown) => void
  function boot(files: string[]) {
    const listeners = new Map<string, Listener>()
    const store = new Map<string, Response>()
    const cache = {
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(u, new Response('x'))),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
    }
    const self = {
      registration: { scope: 'https://example.test/stepquest/' },
      location: { origin: 'https://example.test' },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (t: string, l: Listener) => void listeners.set(t, l),
    }
    const caches = { open: async () => cache, keys: async () => [], match: async (r: Request | string) => store.get(typeof r === 'string' ? r : r.url) }
    const source = swSource.replace('__BUILD_ID__', 'test').replace('/* __PRECACHE__ */ []', JSON.stringify(files))
    new Function('self', 'caches', 'fetch', source)(self, caches, async () => new Response('net'))
    return { listeners, self, store }
  }

  it('precaches the listed files relative to its scope, and waits for the page before taking over', async () => {
    const { listeners, self, store } = boot(['./', 'assets/a.js'])
    let done: Promise<unknown> = Promise.resolve()
    listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
    expect([...store.keys()]).toEqual(['https://example.test/stepquest/', 'https://example.test/stepquest/assets/a.js'])
    listeners.get('message')!({ data: 'other' })
    expect(self.skipWaiting).not.toHaveBeenCalled()
    listeners.get('message')!({ data: 'skip-waiting' })
    expect(self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('leaves other origins (the map servers) and non-GET requests alone', () => {
    const { listeners } = boot([])
    const respondWith = vi.fn()
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://overpass.example/api', mode: 'cors' }, respondWith })
    listeners.get('fetch')!({ request: { method: 'POST', url: 'https://example.test/stepquest/x', mode: 'cors' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://example.test/stepquest/assets/a.js', mode: 'cors' }, respondWith })
    expect(respondWith).toHaveBeenCalledTimes(1)
  })
})
