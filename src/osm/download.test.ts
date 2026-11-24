import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from './cache.ts'
import { encodeOsm } from './codec.ts'
import { overpassQuery } from './demoArea.ts'
import { DownloadError, fetchMirrors } from './download.ts'
import { normalizeOverpass } from './normalize.ts'
import { CACHE_READ_TIMEOUT_MS, OverpassClient, REQUEST_DEADLINE_MS } from './overpass.ts'

const bbox = { south: 39.48, west: -0.4, north: 39.5, east: -0.38 }
const answer = {
  osm3s: { timestamp_osm_base: '2026-11-22T00:00:00Z' },
  elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, nodes: [1, 2], geometry: [{ lat: 39.49, lon: -0.39 }, { lat: 39.491, lon: -0.39 }] }],
}
const ok = () => new Response(JSON.stringify(answer), { status: 200 })
/** A fetch that never answers until aborted. */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))

beforeEach(() => localStorage.clear())

const query = overpassQuery(bbox, 30)
const opts = (endpoints: string[], fetch: (url: string, init?: RequestInit) => Promise<Response>, more: Partial<Parameters<typeof fetchMirrors>[0]> = {}) => ({ query, endpoints, fetch, ...more })

describe('Overpass mirrors, hedged (requirement 20.9)', () => {
  it('asks the first mirror alone and does not touch the others while it answers', async () => {
    const fetch = vi.fn(async () => ok())
    const seen: string[] = []
    const json = await fetchMirrors(opts(['https://one', 'https://two', 'https://three'], fetch, { onMirror: (e) => seen.push(e) }))
    expect(json.elements).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['https://one'])
  })

  it('moves to the next mirror at once when one fails, and keeps the first good answer', async () => {
    const fetch = vi.fn(async (url: string) => (url.includes('bad') ? new Response('', { status: 502 }) : ok()))
    const json = await fetchMirrors(opts(['https://bad', 'https://good', 'https://never'], fetch))
    expect(json.elements).toHaveLength(1)
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://bad', 'https://good'])
  })

  it('asks the next mirror in parallel when the first is quiet past the hedge time, and cancels the loser at its header', async () => {
    const aborted: string[] = []
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => aborted.push(url))
      return url.includes('slow') ? hang(init) : ok()
    })
    const json = await fetchMirrors(opts(['https://slow', 'https://fast'], fetch, { hedgeMs: 5 }))
    expect(json.elements).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(aborted).toContain('https://slow')
  })

  it('gives up on a mirror that sends no header past its timeout and reports the most useful error', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => (url.includes('busy') ? new Response('', { status: 429 }) : hang(init)))
    await expect(fetchMirrors(opts(['https://hang', 'https://busy'], fetch, { headerTimeoutMs: 20, hedgeMs: 5 }))).rejects.toMatchObject({ code: 'rateLimited' })
  })

  it('cuts off an answer that stalls mid-body', async () => {
    const fetch = async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"elements":['))
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200 })
    }
    await expect(fetchMirrors(opts(['https://stall'], fetch, { stallTimeoutMs: 20 }))).rejects.toMatchObject({ code: 'network' })
  })

  it('ends within the total timeout and when the caller aborts, whatever the mirrors do', async () => {
    const fetch = async (_url: string, init?: RequestInit) => hang(init)
    await expect(fetchMirrors(opts(['https://a', 'https://b'], fetch, { totalTimeoutMs: 30, headerTimeoutMs: 10_000, hedgeMs: 10 }))).rejects.toMatchObject({ code: 'network' })
    const stop = new AbortController()
    const run = fetchMirrors(opts(['https://a'], fetch, { signal: stop.signal, headerTimeoutMs: 10_000 }))
    stop.abort()
    await expect(run).rejects.toMatchObject({ code: 'network' })
  })

  it('reports download progress in bytes', async () => {
    const seen: number[] = []
    await fetchMirrors(opts(['https://one'], async () => ok(), { onProgress: (b) => seen.push(b) }))
    expect(seen.at(-1)).toBe(JSON.stringify(answer).length)
  })

  it('asks a short server timeout and leaves out highway kinds nobody walks on', () => {
    const q = overpassQuery(bbox, 30)
    expect(q.startsWith('[out:json][timeout:30];')).toBe(true)
    expect(q).toMatch(/highway"!~"\^\(proposed\|construction/)
  })
})

describe('OverpassClient mirror order and deadline (requirement 20.9)', () => {
  it('asks the mirror that answered last first next time, and rotates after a failure', async () => {
    const order: string[][] = []
    let fail = false
    const download = vi.fn(async (b: typeof bbox, _p?: unknown, extras?: { endpoints?: readonly string[]; onMirror?: (e: string) => void }) => {
      order.push([...(extras?.endpoints ?? [])])
      if (fail) throw new DownloadError('network', 'down')
      extras?.onMirror?.('https://two')
      return encodeOsm(normalizeOverpass(answer, b))
    })
    let now = 1_000_000
    const client = new OverpassClient({ cache: new MemoryCache(), download, now: () => now, endpoints: ['https://one', 'https://two', 'https://three'] })
    await client.loadArea(bbox)
    now += 10_000
    fail = true
    await expect(client.loadArea({ south: 40, west: 1, north: 40.01, east: 1.01 })).rejects.toMatchObject({ code: 'network' })
    now += 10_000
    await expect(client.loadArea({ south: 41, west: 1, north: 41.01, east: 1.01 })).rejects.toBeDefined()
    expect(order[0]).toEqual(['https://one', 'https://two', 'https://three'])
    expect(order[1]).toEqual(['https://two', 'https://one', 'https://three'])
    expect(order[2]).toEqual(['https://one', 'https://three', 'https://two'])
  })

  it('frees its slot when a download never answers, at the deadline', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const download = vi.fn((_b: typeof bbox, _p?: unknown, extras?: { signal?: AbortSignal }) => {
        signal = extras?.signal
        return new Promise<never>(() => undefined)
      })
      const client = new OverpassClient({ cache: new MemoryCache(), download })
      const run = client.loadArea(bbox)
      const caught = run.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(0)
      expect(client.busy).toBe(true)
      await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS + 1)
      expect(await caught).toMatchObject({ code: 'network' })
      expect(client.busy).toBe(false)
      expect(client.running).toBe(0)
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a cache that never answers as a miss and does not wait for it to save', async () => {
    vi.useFakeTimers()
    try {
      const stuck = { get: () => new Promise<never>(() => undefined), set: () => new Promise<never>(() => undefined) }
      const download = vi.fn(async (b: typeof bbox) => encodeOsm(normalizeOverpass(answer, b)))
      const client = new OverpassClient({ cache: stuck, download })
      const run = client.loadCells([{ i: 3949, j: -40 }])
      await vi.advanceTimersByTimeAsync(CACHE_READ_TIMEOUT_MS + 10)
      const res = await run
      expect(res.downloaded).toHaveLength(1)
      expect(download).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('area cache', () => {
  it('serves a smaller area inside an already loaded one without downloading', async () => {
    const download = vi.fn(async () => encodeOsm(normalizeOverpass(answer, bbox)))
    const client = new OverpassClient({ cache: new MemoryCache(), download })
    expect((await client.loadArea(bbox)).fromCache).toBe(false)
    const inner = { south: 39.485, west: -0.395, north: 39.495, east: -0.385 }
    const again = await client.loadArea(inner)
    expect(again.fromCache).toBe(true)
    expect(download).toHaveBeenCalledTimes(1)
    // An area reaching outside it still downloads.
    await expect(client.loadArea({ ...inner, north: 39.51 })).rejects.toMatchObject({ code: 'rateLimited' })
  })

})
