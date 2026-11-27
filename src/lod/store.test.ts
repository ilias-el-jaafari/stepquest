import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_TIMEOUT_MS, LodStore, REDRAW_GAP_MS } from './store.ts'
import { fakeCanvasFactory, makeLod, square } from './testing.ts'

const id = (x: number, y = 6232) => ({ z: 14, x, y })
const tileAt = (x: number) => makeLod(id(x), { lines: [{ cls: 'minor', pts: [[0, 100], [4096, 100]] }], areas: [{ layer: 'building', ring: square(100, 100, 100) }] })

function setup(over: ConstructorParameters<typeof LodStore>[0] = {}) {
  const f = fakeCanvasFactory()
  const jobs: (() => void)[] = []
  const store = new LodStore({ canvas: f.make, later: (fn) => jobs.push(fn), ...over })
  /** Run queued tasks one at a time until none is left. */
  const drain = () => {
    let n = 0
    while (jobs.length && n++ < 10_000) jobs.shift()!()
    return n
  }
  return { store, f, jobs, drain }
}

describe('LOD store (requirements 25.4 and 25.5)', () => {
  it('paints a bitmap one slice per task, then hands it out, and says so to the renderer once', () => {
    const { store, jobs, drain } = setup({ sliceMs: 0 })
    let notices = 0
    store.subscribe(() => notices++)
    store.put(tileAt(1))
    const afterPut = notices
    store.beginFrame()
    store.want(id(1), 512)
    store.endFrame()
    expect(store.bitmap(id(1), 512)).toBeUndefined()
    expect(jobs).toHaveLength(1)
    expect(drain()).toBeGreaterThan(3)
    expect(store.bitmap(id(1), 512)?.level).toBe(512)
    expect(notices - afterPut).toBe(1)
    expect(store.stats.bitmapsDone).toBe(1)
  })

  it('reuses a bitmap: asking again for the same level (zooming inside it) paints nothing', () => {
    const { store, f, drain } = setup()
    store.put(tileAt(1))
    for (let k = 0; k < 5; k++) {
      store.beginFrame()
      store.want(id(1), 512)
      store.endFrame()
      drain()
    }
    expect(f.made).toHaveLength(1)
    expect(store.stats.bitmapsDone).toBe(1)
  })

  it('draws a bitmap of another level, nearest in size, while the right one is not ready', () => {
    const { store, drain } = setup()
    store.put(tileAt(1))
    store.beginFrame()
    store.want(id(1), 256)
    store.endFrame()
    drain()
    store.beginFrame()
    store.want(id(1), 768)
    store.endFrame()
    expect(store.bitmap(id(1), 768)).toMatchObject({ level: 256 })
    drain()
    expect(store.bitmap(id(1), 768)).toMatchObject({ level: 768 })
  })

  it('keeps the bitmaps within the byte budget, dropping the least recently used and never one the frame wants', () => {
    const budget = 3 * 256 * 256 * 4
    const { store, drain } = setup({ bitmapBudgetBytes: budget })
    for (let x = 1; x <= 6; x++) store.put(tileAt(x))
    for (let x = 1; x <= 6; x++) {
      store.beginFrame()
      store.want(id(x), 256)
      store.endFrame()
      drain()
    }
    expect(store.bytes).toBeLessThanOrEqual(budget)
    expect(store.bitmapCount).toBe(3)
    // The newest are kept.
    expect(store.bitmap(id(6), 256)).toBeDefined()
    expect(store.bitmap(id(1), 256)).toBeUndefined()
    // A frame that wants four tiles keeps them all while they are wanted, even above the budget, and drops the rest after.
    store.beginFrame()
    for (const x of [3, 4, 5, 6]) store.want(id(x), 256)
    store.endFrame()
    drain()
    expect(store.bitmap(id(3), 256) ?? store.bitmap(id(4), 256)).toBeDefined()
  })

  it('drops painting jobs nobody wants any more and releases their canvases', () => {
    const { store, drain } = setup()
    store.put(tileAt(1))
    store.put(tileAt(2))
    store.beginFrame()
    store.want(id(1), 512)
    store.want(id(2), 512)
    store.endFrame()
    store.beginFrame()
    store.want(id(2), 512)
    store.endFrame()
    expect(store.pending).toBe(1)
    drain()
    expect(store.bitmapCount).toBe(1)
  })

  it('wants nothing for a tile that is not in, and tracks pending, failed and ready', () => {
    const { store } = setup()
    store.beginFrame()
    store.want(id(9), 256)
    store.endFrame()
    expect(store.bitmapCount).toBe(0)
    expect(store.state(id(9))).toBe('unknown')
    store.markPending(id(9))
    expect(store.state(id(9))).toBe('pending')
    store.markFailed(id(9))
    expect(store.state(id(9))).toBe('failed')
    store.put(tileAt(9))
    expect(store.state(id(9))).toBe('ready')
    store.markFailed(id(9))
    expect(store.state(id(9))).toBe('ready')
    expect(store.has(id(9))).toBe(true)
    expect(store.has(id(10))).toBe(false)
  })

  it('keeps at most the resident limit of tiles, the oldest go first', () => {
    const { store } = setup({ maxResident: 3 })
    for (let x = 1; x <= 5; x++) store.put(tileAt(x))
    expect(store.resident().map((t) => t.id.x)).toEqual([3, 4, 5])
    expect(store.state(id(1))).toBe('unknown')
  })
})

describe('painting between frames (requirement 25.5, far-pan budget)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a backlog of bitmaps redraws the scene at most once per REDRAW_GAP_MS, and once more when the backlog is done', () => {
    let t = 0
    const { store, drain } = setup({ sliceMs: 0, now: () => t })
    for (let x = 1; x <= 12; x++) store.put(tileAt(x))
    let notices = 0
    store.subscribe(() => notices++)
    store.beginFrame()
    for (let x = 1; x <= 12; x++) store.want(id(x), 256)
    store.endFrame()
    // Each task takes 2 ms of the clock: the 12 bitmaps (about 22 slices each) span about half a second.
    const jobsRun = (() => {
      let n = 0
      const orig = store.slice.bind(store)
      store.slice = () => {
        t += 2
        n++
        orig()
      }
      return () => n
    })()
    drain()
    expect(store.stats.bitmapsDone).toBe(12)
    expect(jobsRun()).toBeGreaterThan(12)
    const spanMs = t
    expect(notices).toBeLessThanOrEqual(Math.ceil(spanMs / REDRAW_GAP_MS) + 1)
    expect(notices).toBeLessThan(12)
    expect(notices).toBeGreaterThan(0)
    for (let x = 1; x <= 12; x++) expect(store.bitmap(id(x), 256)?.level).toBe(256)
  })

  it('by default a slice waits for an idle moment (at most IDLE_TIMEOUT_MS), and without idle callbacks it leaves a pause between slices', () => {
    const idle: { fn: () => void; timeout: number | undefined }[] = []
    vi.stubGlobal('requestIdleCallback', (fn: () => void, o?: { timeout: number }) => idle.push({ fn, timeout: o?.timeout }))
    const f = fakeCanvasFactory()
    const a = new LodStore({ canvas: f.make })
    a.put(tileAt(1))
    a.beginFrame()
    a.want(id(1), 256)
    a.endFrame()
    expect(idle).toHaveLength(1)
    expect(idle[0]!.timeout).toBe(IDLE_TIMEOUT_MS)
    expect(a.stats.slices).toBe(0)
    idle[0]!.fn()
    expect(a.stats.slices).toBe(1)

    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    const b = new LodStore({ canvas: f.make })
    b.put(tileAt(2))
    b.beginFrame()
    b.want(id(2), 256)
    b.endFrame()
    vi.advanceTimersByTime(1)
    expect(b.stats.slices).toBe(0)
    vi.advanceTimersByTime(20)
    expect(b.stats.slices).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})
