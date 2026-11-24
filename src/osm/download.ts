import type { BBox } from '../geo/geo.ts'
import { encodeOsm, type CompactOsm } from './codec.ts'
import { overpassQuery } from './demoArea.ts'
import { normalizeOverpass, type OverpassResponse } from './normalize.ts'

export type DownloadErrorCode = 'network' | 'badResponse' | 'rateLimited' | 'busy'

export class DownloadError extends Error {
  readonly code: DownloadErrorCode
  constructor(code: DownloadErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** The query asks the server to give up after this long. */
export const QUERY_TIMEOUT_S = 30
/** A mirror that has not sent its answer header after this long is given up on (the server needs time to run the query). */
export const HEADER_TIMEOUT_MS = 25_000
/** A started answer that goes quiet this long is cut off (a stalled mobile link). */
export const STALL_TIMEOUT_MS = 12_000
/** The next mirror is asked in parallel when the first has not answered after this long (hedging). */
export const HEDGE_MS = 6_000
/** No download takes longer than this, whatever the mirrors do (requirement 20.9). */
export const TOTAL_TIMEOUT_MS = 60_000

export type MirrorOptions = {
  endpoints: readonly string[]
  fetch: FetchLike
  /** Overpass QL to send. */
  query: string
  hedgeMs?: number
  headerTimeoutMs?: number
  stallTimeoutMs?: number
  totalTimeoutMs?: number
  /** Cancels everything (the caller's own deadline). */
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
  /** The mirror whose answer was used. */
  onMirror?: (endpoint: string) => void
}

/** Read a body while reporting bytes, and cut it off when no chunk arrives for `stallMs`. */
async function readText(response: Response, stallMs: number, stall: () => void, onProgress?: (bytes: number) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return response.text()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const timer = setTimeout(stall, stallMs)
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } finally {
      clearTimeout(timer)
    }
    if (chunk.done) break
    bytes += chunk.value.byteLength
    text += decoder.decode(chunk.value, { stream: true })
    onProgress?.(bytes)
  }
  return text + decoder.decode()
}

/**
 * A usable answer is a JSON object with an `elements` array. Without one (an HTML error page that
 * parsed, `null`, a bare remark) the area would look empty and be cached for a week as "no streets here".
 */
export function isOverpassResponse(json: unknown): json is OverpassResponse {
  return !!json && typeof json === 'object' && Array.isArray((json as OverpassResponse).elements)
}

type Shared = { winner: number; cancelled: boolean; controllers: (AbortController | undefined)[] }

async function fromMirror(i: number, shared: Shared, o: MirrorOptions): Promise<OverpassResponse> {
  const controller = (shared.controllers[i] = new AbortController())
  if (shared.cancelled) controller.abort()
  const endpoint = o.endpoints[i]!
  const headerTimer = setTimeout(() => controller.abort(), o.headerTimeoutMs ?? HEADER_TIMEOUT_MS)
  let response: Response
  try {
    response = await o.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(o.query)}`,
      signal: controller.signal,
    })
  } catch (error) {
    throw new DownloadError('network', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(headerTimer)
  }
  if (response.status === 429 || response.status === 504) throw new DownloadError('rateLimited', `Overpass is busy (${response.status})`)
  if (!response.ok) throw new DownloadError('badResponse', `Overpass answered ${response.status}`)
  // The first mirror with a good header owns the link: the others stop now, before they send a body.
  if (shared.winner >= 0 && shared.winner !== i) throw new DownloadError('network', 'Another mirror answered first')
  shared.winner = i
  shared.controllers.forEach((c, j) => j !== i && c?.abort())
  let json: OverpassResponse
  try {
    json = JSON.parse(await readText(response, o.stallTimeoutMs ?? STALL_TIMEOUT_MS, () => controller.abort(), o.onProgress)) as OverpassResponse
  } catch (error) {
    shared.winner = -1
    throw new DownloadError(controller.signal.aborted ? 'network' : 'badResponse', error instanceof Error ? error.message : String(error))
  }
  // A timed-out query answers 200 with a remark and (maybe partial) elements: never use it.
  if (typeof json?.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) {
    shared.winner = -1
    throw new DownloadError('busy', json.remark)
  }
  if (!isOverpassResponse(json)) {
    shared.winner = -1
    throw new DownloadError('badResponse', 'Overpass answered something that is not a map extract')
  }
  return json
}

const PRIORITY: DownloadErrorCode[] = ['network', 'badResponse', 'busy', 'rateLimited']

/**
 * Ask the mirrors in order, hedged: the first is asked at once; the next one joins when the one
 * before has failed or has been quiet for `hedgeMs`. The first mirror to send a good answer header
 * wins and the others are aborted before they send a body, so a phone never splits its link between
 * several downloads. Every mirror gets one request per call and has its own header timeout; the
 * whole call ends within `totalTimeoutMs` or when `signal` aborts. Throws the most useful error.
 */
export async function fetchMirrors(o: MirrorOptions): Promise<OverpassResponse> {
  const n = o.endpoints.length
  const shared: Shared = { winner: -1, cancelled: false, controllers: [] }
  const errors: DownloadError[] = []
  let hedge: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => {
    shared.cancelled = true
    shared.controllers.forEach((c) => c?.abort())
  }
  if (o.signal?.aborted) onAbort()
  o.signal?.addEventListener('abort', onAbort)
  const total = setTimeout(onAbort, o.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)
  try {
    return await new Promise<OverpassResponse>((resolve, reject) => {
      let started = 0
      let failed = 0
      let done = false
      const start = () => {
        if (done || started >= n) return
        const i = started++
        fromMirror(i, shared, o).then(
          (json) => {
            if (done) return
            done = true
            o.onMirror?.(o.endpoints[i]!)
            resolve(json)
          },
          (error: unknown) => {
            if (done) return
            errors.push(error instanceof DownloadError ? error : new DownloadError('network', String(error)))
            if (++failed >= n) {
              done = true
              reject(new AggregateError(errors))
            } else start()
          },
        )
        clearTimeout(hedge)
        if (started < n) hedge = setTimeout(start, o.hedgeMs ?? HEDGE_MS)
      }
      start()
    })
  } catch (error) {
    const list = (error instanceof AggregateError ? error.errors : [error]).filter((e): e is DownloadError => e instanceof DownloadError)
    list.sort((a, b) => PRIORITY.indexOf(b.code) - PRIORITY.indexOf(a.code))
    throw list[0] ?? new DownloadError('network', 'No Overpass mirror answered')
  } finally {
    clearTimeout(hedge)
    clearTimeout(total)
    o.signal?.removeEventListener('abort', onAbort)
    shared.controllers.forEach((c) => c?.abort())
  }
}

export type DownloadOptions = Omit<MirrorOptions, 'query'>

/** Download and convert one area to the compact form (runs in a worker when possible). */
export async function downloadArea(bbox: BBox, opts: DownloadOptions & { query?: string }): Promise<CompactOsm> {
  const json = await fetchMirrors({ ...opts, query: opts.query ?? overpassQuery(bbox, QUERY_TIMEOUT_S) })
  return encodeOsm(normalizeOverpass(json, bbox, 'overpass'))
}
