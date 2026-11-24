import type { FetchLike } from '../osm/download.ts'

export type TileErrorCode = 'network' | 'badResponse' | 'rateLimited' | 'busy'

/** A vector tile that could not be loaded; `code` drives the back-off (requirement 21.8). */
export class TileError extends Error {
  readonly code: TileErrorCode
  constructor(code: TileErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** One tile request, headers and body, ends after this long (a CDN answers in well under a second; a phone link may stall). */
export const TILE_TIMEOUT_MS = 15_000

/**
 * Fetch one tile's bytes. 204 and 404 are an empty tile (open sea, no data), 429 is `rateLimited`,
 * any other failure or a timeout is `network` / `badResponse`. Runs in the worker or in the thread.
 */
export async function fetchTileBytes(url: string, fetchFn: FetchLike, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TILE_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await fetchFn(url, { signal: controller.signal })
    } catch (error) {
      throw new TileError('network', error instanceof Error ? error.message : String(error))
    }
    if (res.status === 204 || res.status === 404) return new Uint8Array(0)
    if (res.status === 429) throw new TileError('rateLimited', 'Tile server busy (429)')
    if (!res.ok) throw new TileError(res.status >= 500 ? 'network' : 'badResponse', `Tile server answered ${res.status}`)
    try {
      return new Uint8Array(await res.arrayBuffer())
    } catch (error) {
      throw new TileError('network', error instanceof Error ? error.message : String(error))
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
