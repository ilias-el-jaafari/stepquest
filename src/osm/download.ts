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

/** Give up on one mirror after this long (the query itself asks the server for 30 s). */
export const MIRROR_TIMEOUT_MS = 40_000
export const QUERY_TIMEOUT_S = 30

/** Read a body while reporting how many bytes have arrived. */
async function readText(response: Response, onProgress?: (bytes: number) => void): Promise<string> {
  const reader = onProgress && response.body ? response.body.getReader() : undefined
  if (!reader || !onProgress) return response.text()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
    onProgress(bytes)
  }
  return text + decoder.decode()
}

async function fromMirror(endpoint: string, bbox: BBox, fetchFn: FetchLike, signal: AbortSignal, onProgress?: (bytes: number) => void): Promise<OverpassResponse> {
  let response: Response
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery(bbox, QUERY_TIMEOUT_S))}`,
      signal,
    })
  } catch (error) {
    throw new DownloadError('network', error instanceof Error ? error.message : String(error))
  }
  if (response.status === 429 || response.status === 504) throw new DownloadError('rateLimited', `Overpass is busy (${response.status})`)
  if (!response.ok) throw new DownloadError('badResponse', `Overpass answered ${response.status}`)
  let json: OverpassResponse
  try {
    json = JSON.parse(await readText(response, onProgress)) as OverpassResponse
  } catch (error) {
    throw new DownloadError(signal.aborted ? 'network' : 'badResponse', error instanceof Error ? error.message : String(error))
  }
  // A timed-out query answers 200 with a remark and (maybe partial) elements: never use it.
  if (typeof json?.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) throw new DownloadError('busy', json.remark)
  if (!isOverpassResponse(json)) throw new DownloadError('badResponse', 'Overpass answered something that is not a map extract')
  return json
}

/**
 * A usable answer is a JSON object with an `elements` array. Without one (an
 * HTML error page that parsed, `null`, a bare remark) the area would look empty
 * and be cached for a week as "no streets here".
 */
export function isOverpassResponse(json: unknown): json is OverpassResponse {
  return !!json && typeof json === 'object' && Array.isArray((json as OverpassResponse).elements)
}

const PRIORITY: DownloadErrorCode[] = ['network', 'badResponse', 'busy', 'rateLimited']

/**
 * Ask every mirror at once (one request each) and keep the first good answer;
 * the others are cancelled. Each mirror has its own timeout. Progress counts
 * the bytes of whichever answer arrives first.
 */
export async function raceMirrors(
  bbox: BBox,
  opts: { endpoints: readonly string[]; fetch: FetchLike; timeoutMs?: number; onProgress?: (bytes: number) => void },
): Promise<OverpassResponse> {
  const controllers = opts.endpoints.map(() => new AbortController())
  const timers = controllers.map((c) => setTimeout(() => c.abort(), opts.timeoutMs ?? MIRROR_TIMEOUT_MS))
  let leader = -1
  try {
    return await Promise.any(
      opts.endpoints.map((endpoint, i) =>
        fromMirror(endpoint, bbox, opts.fetch, controllers[i]!.signal, (bytes) => {
          if (leader < 0) leader = i
          if (leader === i) opts.onProgress?.(bytes)
        }).then((json) => {
          controllers.forEach((c, j) => j !== i && c.abort())
          return json
        }),
      ),
    )
  } catch (error) {
    const errors = (error instanceof AggregateError ? error.errors : [error]).filter((e): e is DownloadError => e instanceof DownloadError)
    errors.sort((a, b) => PRIORITY.indexOf(b.code) - PRIORITY.indexOf(a.code))
    throw errors[0] ?? new DownloadError('network', 'No Overpass mirror answered')
  } finally {
    timers.forEach(clearTimeout)
  }
}

/** Download and convert one area to the compact form (runs in a worker when possible). */
export async function downloadArea(
  bbox: BBox,
  opts: { endpoints: readonly string[]; fetch: FetchLike; timeoutMs?: number; onProgress?: (bytes: number) => void },
): Promise<CompactOsm> {
  const json = await raceMirrors(bbox, opts)
  return encodeOsm(normalizeOverpass(json, bbox, 'overpass'))
}
