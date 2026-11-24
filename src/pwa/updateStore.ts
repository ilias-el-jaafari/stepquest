/** The part of `ServiceWorkerContainer` and `ServiceWorkerRegistration` the update flow uses. */
export type WorkerLike = { state: string; postMessage(message: unknown): void; addEventListener(type: 'statechange', listener: () => void): void }
export type RegistrationLike = {
  waiting: WorkerLike | null
  installing: WorkerLike | null
  addEventListener(type: 'updatefound', listener: () => void): void
}
export type ContainerLike = {
  controller: unknown
  register(url: string): Promise<RegistrationLike>
  addEventListener(type: 'controllerchange', listener: () => void): void
}

export type UpdateSnapshot = { updateReady: boolean }

/**
 * Tracks whether a new version of the app waits to take over. It never reloads by itself:
 * `apply()` (the user's tap on "Update") tells the waiting worker to take over, and the page
 * reloads once, when the new worker has control.
 */
export class UpdateStore {
  private snapshot: UpdateSnapshot = { updateReady: false }
  private waiting: WorkerLike | undefined
  private applying = false
  private readonly listeners = new Set<() => void>()
  private readonly reload: () => void
  constructor(reload: () => void = () => location.reload()) {
    this.reload = reload
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): UpdateSnapshot => this.snapshot

  private markReady(worker: WorkerLike) {
    this.waiting = worker
    this.snapshot = { updateReady: true }
    for (const l of this.listeners) l()
  }

  /** The user chose to update now. */
  apply = (): void => {
    this.applying = true
    this.waiting?.postMessage('skip-waiting')
  }

  /** Hide the prompt until the next visit (the waiting worker stays in place). */
  dismiss = (): void => {
    this.snapshot = { updateReady: false }
    for (const l of this.listeners) l()
  }

  /** Register the worker and watch for versions that finish installing while the app is open. */
  async attach(container: ContainerLike, url: string): Promise<void> {
    // The very first install has no controller: that is not an update.
    container.addEventListener('controllerchange', () => {
      if (this.applying) this.reload()
    })
    const registration = await container.register(url)
    if (registration.waiting && container.controller) this.markReady(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && container.controller) this.markReady(worker)
      })
    })
  }
}

export const updateStore = new UpdateStore()

/** Register the service worker (production builds in browsers that have one). Failures are ignored: the app works without it. */
export function registerServiceWorker(url: string, container: ContainerLike | undefined = typeof navigator === 'undefined' ? undefined : (navigator.serviceWorker as unknown as ContainerLike | undefined)): void {
  if (!container) return
  void updateStore.attach(container, url).catch(() => {})
}
