import { useCallback, useMemo, useRef, useState } from 'react'
import { bboxCenter, type BBox } from '../geo/geo.ts'
import { decodeOsm, type CompactOsm } from '../osm/codec.ts'
import { defaultCache } from '../osm/cache.ts'
import { OverpassClient, type OverpassErrorCode } from '../osm/overpass.ts'
import type { OsmData } from '../osm/types.ts'
import { WalkGraph } from '../routing/graph.ts'
import { safetyContext } from '../routing/safety.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { cellKey, cellOf, cellsInBBox, type CellId } from '../world/cells.ts'
import { LiveWorld, type World } from '../world/liveWorld.ts'
import { loadWalkRecords, WalkAreaError, type WalkProgress, type WalkTileSource } from '../world/walkArea.ts'

export type { World }

/** A world of one extract, not streamed (tests and scripts). */
export function buildWorld(data: OsmData): World {
  const graph = new WalkGraph(data)
  return { data, grid: buildTileGrid(data), graph, safety: safetyContext(graph, data) }
}

/** A streamed world seeded with an extract: it grows by cells as the map moves (requirement 19). */
export function streamedWorld(data: OsmData): World {
  return LiveWorld.fromData(data).world()
}

/** The bundled Benicalap demo, as the first cells of a streamed world (works offline). */
export async function loadDemoWorld(): Promise<World> {
  const fixture = (await import('../data/benicalap.osm.json')).default as unknown as CompactOsm
  return streamedWorld(decodeOsm(fixture))
}

export type LiveStatus =
  | { state: 'idle' }
  | { state: 'loading'; done: number; total: number }
  | { state: 'done'; fromCache: boolean }
  | { state: 'error'; code: OverpassErrorCode }

type Progress = (p: WalkProgress) => void
type Job<T> = { promise: Promise<T>; listeners: Set<Progress>; last: WalkProgress | undefined }

/**
 * Holds the live clients for the session (one per tab, so throttling works) and loads the walking
 * graph of an area from vector tiles (requirement 23). A second request for the same cells joins the
 * one that is running, so a press of "Plan quest" never starts a load that is already on its way.
 */
export function useLiveLoader(tiles: WalkTileSource) {
  const client = useMemo(() => new OverpassClient({ cache: defaultCache() }), [])
  const [status, setStatus] = useState<LiveStatus>({ state: 'idle' })
  const jobs = useRef(new Map<string, Job<unknown>>())

  const run = useCallback(
    <T>(cells: readonly CellId[], onProgress: Progress | undefined, work: (progress: Progress) => Promise<T>): Promise<T> => {
      const key = cells.map(cellKey).sort().join(';')
      const known = jobs.current.get(key) as Job<T> | undefined
      if (known) {
        if (onProgress) {
          known.listeners.add(onProgress)
          if (known.last) onProgress(known.last)
        }
        return known.promise
      }
      const job: Job<T> = { promise: undefined as never, listeners: new Set(onProgress ? [onProgress] : []), last: undefined }
      const progress: Progress = (p) => {
        job.last = p
        setStatus({ state: 'loading', done: p.done, total: p.total })
        for (const fn of job.listeners) fn(p)
      }
      setStatus({ state: 'loading', done: 0, total: 0 })
      job.promise = work(progress).then(
        (v) => {
          setStatus({ state: 'done', fromCache: false })
          return v
        },
        (error: unknown) => {
          setStatus({ state: 'error', code: error instanceof WalkAreaError && error.code === 'timeout' ? 'busy' : 'network' })
          throw error
        },
      )
      jobs.current.set(key, job as Job<unknown>)
      void job.promise.then(
        () => jobs.current.delete(key),
        () => jobs.current.delete(key),
      )
      return job.promise
    },
    [],
  )

  /** A new streamed world around a box, its streets from tiles. Throws `WalkAreaError`. */
  const load = useCallback(
    (bbox: BBox, onProgress?: Progress): Promise<World> => {
      const cells = cellsInBBox(bbox)
      return run(cells, onProgress, async (progress) => {
        const live = new LiveWorld(cellOf(bboxCenter(bbox)), [])
        live.addWalkNet(await loadWalkRecords(cells, tiles, { onProgress: progress }))
        return live.world()
      })
    },
    [run, tiles],
  )

  /** Add the streets of `cells` to a streamed world already on screen. Throws `WalkAreaError`. */
  const grow = useCallback(
    (live: LiveWorld, cells: readonly CellId[], onProgress?: Progress, opts?: { alongside?: boolean }): Promise<World> =>
      run(cells, onProgress, async (progress) => {
        live.addWalkNet(await loadWalkRecords(cells, tiles, { onProgress: progress }), opts)
        return live.world()
      }),
    [run, tiles],
  )

  return { status, load, grow, client }
}
