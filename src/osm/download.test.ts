import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from './cache.ts'
import { encodeOsm } from './codec.ts'
import { overpassQuery } from './demoArea.ts'
import { raceMirrors } from './download.ts'
import { normalizeOverpass } from './normalize.ts'
import { OverpassClient } from './overpass.ts'

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

describe('Overpass mirrors race', () => {
  it('asks every mirror at once, keeps the first good answer and cancels the rest', async () => {
    const aborted: string[] = []
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => aborted.push(url))
      if (url.includes('slow')) return hang(init)
      if (url.includes('bad')) return new Response('', { status: 502 })
      return ok()
    })
    const json = await raceMirrors(bbox, { endpoints: ['https://slow', 'https://bad', 'https://fast'], fetch })
    expect(json.elements).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(aborted).toContain('https://slow')
  })

  it('gives up on a mirror that hangs past its timeout and reports the most useful error', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => (url.includes('busy') ? new Response('', { status: 429 }) : hang(init)))
    await expect(raceMirrors(bbox, { endpoints: ['https://hang', 'https://busy'], fetch, timeoutMs: 20 })).rejects.toMatchObject({ code: 'rateLimited' })
  })

  it('reports download progress in bytes', async () => {
    const seen: number[] = []
    await raceMirrors(bbox, { endpoints: ['https://one'], fetch: async () => ok(), onProgress: (b) => seen.push(b) })
    expect(seen.at(-1)).toBe(JSON.stringify(answer).length)
  })

  it('asks a short server timeout and leaves out highway kinds nobody walks on', () => {
    const q = overpassQuery(bbox, 30)
    expect(q.startsWith('[out:json][timeout:30];')).toBe(true)
    expect(q).toMatch(/highway"!~"\^\(proposed\|construction/)
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
