import type { BBox } from '../geo/geo.ts'
import type { OsmData } from '../osm/types.ts'
import { MAX_TILES_IN_FLIGHT } from '../vector/client.ts'
import { DETAIL_Z, tilesForCell } from '../vector/assemble.ts'
import { TileError } from '../vector/fetchTile.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { buildWalkNet } from '../vector/walkNet.ts'
import { cellsBBox, cellsInBBox, planBatch, type CellId } from './cells.ts'
import type { GraphClient } from './streamer.ts'
import type { CellRecord } from './slice.ts'
import { sliceToCells } from './slice.ts'

/**
 * Loading the walking graph of an area from vector tiles (map-rendering requirement 23, routing 13).
 * Pure scheduling and assembly: the tile source and the clock are given, so tests run without a network.
 */

/** The whole load ends after this long, whatever the tiles do (requirement 23.2). */
export const WALK_DEADLINE_MS = 40_000
/** A tile that failed is asked again this many times, after `RETRY_MS[k]` (±25 %). */
export const TILE_RETRIES = 2
export const RETRY_MS = [1_000, 2_000]
/** A `busy` answer (every tile slot is taken by the map) waits this long and does not count as a failure. */
const BUSY_WAIT_MS = 250

export type WalkProgress = { done: number; total: number }
export type WalkErrorCode = 'timeout' | 'network' | 'aborted'

export class WalkAreaError extends Error {
  readonly code: WalkErrorCode
  constructor(code: WalkErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** What the loader needs of the tile client. */
export type WalkTileSource = { loadTile(t: TileId): Promise<OsmData> }

export type WalkOptions = {
  onProgress?: (p: WalkProgress) => void
  signal?: AbortSignal
  deadlineMs?: number
  /** Waits `ms` (tests pass a fast one). */
  sleep?: (ms: number) => Promise<void>
  /** At most this many downloads at once (default: the tile client's own limit of 4). */
  parallel?: number
  random?: () => number
}

/** The z14 tiles that cells need for their streets (shared tiles once). */
export function walkTiles(cells: readonly CellId[]): TileId[] {
  const seen = new Map<string, TileId>()
  for (const c of cells) for (const t of tilesForCell(c, DETAIL_Z)) seen.set(tileKey(t), t)
  return [...seen.values()]
}

/** The cells of a box (the walk area), nearest the centre first so a partial answer is still useful. */
export const cellsOf = (box: BBox): CellId[] => cellsInBBox(box)

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Walking records for `cells`: every tile they need is loaded (cache first, at most 4 at a time, two
 * retries each, one deadline for all), the streets of all tiles are made one network, and the network
 * is cut into one record per cell. Throws `WalkAreaError`.
 */
export async function loadWalkRecords(cells: readonly CellId[], tiles: WalkTileSource, opts: WalkOptions = {}): Promise<CellRecord[]> {
  if (!cells.length) return []
  const sleep = opts.sleep ?? defaultSleep
  const random = opts.random ?? Math.random
  const need = walkTiles(cells)
  const total = need.length
  const loaded = new Map<string, OsmData>()
  const controller = new AbortController()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.deadlineMs ?? WALK_DEADLINE_MS)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  if (opts.signal?.aborted) controller.abort()
  const stop = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new WalkAreaError(timedOut ? 'timeout' : 'aborted', timedOut ? 'Loading the streets took too long' : 'Cancelled')))
  })
  stop.catch(() => undefined)
  opts.onProgress?.({ done: 0, total })

  const fetchOne = async (t: TileId): Promise<void> => {
    let failures = 0
    for (;;) {
      if (controller.signal.aborted) return
      try {
        const data = await Promise.race([tiles.loadTile(t), stop])
        loaded.set(tileKey(t), data)
        opts.onProgress?.({ done: loaded.size, total })
        return
      } catch (error) {
        if (error instanceof WalkAreaError) throw error
        if (error instanceof TileError && error.code === 'busy') {
          await Promise.race([sleep(BUSY_WAIT_MS), stop])
          continue
        }
        if (failures >= TILE_RETRIES) throw new WalkAreaError('network', error instanceof Error ? error.message : String(error))
        const wait = RETRY_MS[failures]! * (0.75 + random() * 0.5)
        failures++
        await Promise.race([sleep(wait), stop])
      }
    }
  }

  try {
    const queue = [...need]
    const workers = Array.from({ length: Math.min(opts.parallel ?? MAX_TILES_IN_FLIGHT, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await fetchOne(t)
    })
    await Promise.race([Promise.all(workers), stop])
  } catch (error) {
    controller.abort()
    throw error instanceof WalkAreaError ? error : new WalkAreaError('network', String(error))
  } finally {
    clearTimeout(deadline)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  if (controller.signal.aborted) throw new WalkAreaError(timedOut ? 'timeout' : 'aborted', 'Cancelled')
  const box = cellsBBox(cells)
  const net = buildWalkNet(
    need.map((t) => loaded.get(tileKey(t))!),
    box,
  )
  return sliceToCells(net, cells, box)
}

/** Overpass enrichment limits (requirement 23.5). */
export const ENRICH_REQUEST_MS = 12_000
export const ENRICH_BATCH = 2

export type EnrichTarget = { enrich(records: readonly CellRecord[]): number; hasWalk?(c: CellId): boolean }

/**
 * Tags from Overpass for walking records: cached cells first, at once; the rest from the network, in
 * the background, one request at a time of at most `ENRICH_BATCH` cells, each ending after 12 s, and
 * stopping at the first failure (a busy server is not asked again for this area). Never throws.
 * `changed` is called after each batch that tagged something.
 */
export async function enrichFromOverpass(cells: readonly CellId[], graph: GraphClient, target: EnrichTarget, opts: { network: boolean; signal?: AbortSignal; changed?: () => void }): Promise<void> {
  const missing: CellId[] = []
  for (const c of cells) {
    if (opts.signal?.aborted) return
    const hit = await graph.cachedCell(c).catch(() => undefined)
    if (hit) {
      if (target.enrich([hit]) > 0) opts.changed?.()
    } else missing.push(c)
  }
  if (!opts.network) return
  let left = [...missing]
  while (left.length && !opts.signal?.aborted) {
    const wait = graph.waitMs()
    if (graph.busy) return
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const batch = planBatch(left, ENRICH_BATCH)
    left = left.filter((c) => !batch.some((b) => b.i === c.i && b.j === c.j))
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const res = await Promise.race([
        graph.loadCells(batch),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('slow')), ENRICH_REQUEST_MS)
        }),
      ]).finally(() => clearTimeout(timer))
      if (target.enrich(res.records) > 0) opts.changed?.()
    } catch {
      return
    }
  }
}
