import { describe, expect, it, vi } from 'vitest'
import { keepScreenOn } from './wakeLock.ts'

type Sentinel = { release: ReturnType<typeof vi.fn>; released: boolean; listeners: (() => void)[]; addEventListener: (t: 'release', cb: () => void) => void }
const sentinel = (): Sentinel => {
  const s: Sentinel = {
    released: false,
    listeners: [],
    addEventListener: (_t, cb) => void s.listeners.push(cb),
    release: vi.fn(async () => {
      s.released = true
      s.listeners.forEach((cb) => cb())
    }),
  }
  return s
}
const makeDoc = () => {
  const handlers: (() => void)[] = []
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_t: string, cb: () => void) => void handlers.push(cb),
    removeEventListener: vi.fn(),
  }
  return { doc, fire: () => handlers.forEach((h) => h()) }
}
const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('wake lock (review)', () => {
  it('never holds two locks: a visibility change while the first request is pending does not start another', async () => {
    const made: Sentinel[] = []
    let open!: (s: Sentinel) => void
    const request = vi.fn(() => new Promise<Sentinel>((res) => (open = (s) => (made.push(s), res(s)))))
    const { doc, fire } = makeDoc()
    const handle = keepScreenOn({ request } as never, doc as never)
    fire()
    fire()
    expect(request).toHaveBeenCalledTimes(1)
    open(sentinel())
    await tick()
    expect(handle.active()).toBe(true)
    handle.release()
    expect(made[0]!.release).toHaveBeenCalledTimes(1)
  })

  it('releases a lock that resolves after release() and never reports it active', async () => {
    let open!: (s: Sentinel) => void
    const request = vi.fn(() => new Promise<Sentinel>((res) => (open = res)))
    const { doc } = makeDoc()
    const handle = keepScreenOn({ request } as never, doc as never)
    handle.release()
    const late = sentinel()
    // A fake that does not flip `released` on its own: the handle must not trust the sentinel it was given late.
    late.release = vi.fn(async () => {})
    open(late)
    await tick()
    expect(late.release).toHaveBeenCalledTimes(1)
    expect(handle.active()).toBe(false)
  })

  it('tells the UI when the lock is gained and lost, and gets it back when the page is visible again', async () => {
    const first = sentinel()
    const second = sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { doc, fire } = makeDoc()
    const changes: boolean[] = []
    const handle = keepScreenOn({ request } as never, doc as never, (a) => changes.push(a))
    await tick()
    expect(changes).toEqual([true])
    // The browser drops the lock when the page is hidden.
    await (first.release as () => Promise<void>)()
    expect(changes).toEqual([true, false])
    expect(handle.active()).toBe(false)
    fire()
    await tick()
    expect(changes).toEqual([true, false, true])
    expect(handle.active()).toBe(true)
    handle.release()
    expect(second.release).toHaveBeenCalled()
  })
})
