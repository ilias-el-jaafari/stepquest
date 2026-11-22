import { useCallback, useMemo, useRef, useState } from 'react'
import type { BBox } from '../geo/geo.ts'
import { decodeOsm, type CompactOsm } from '../osm/codec.ts'
import { defaultCache } from '../osm/cache.ts'
import { OverpassClient, OverpassError, type OverpassErrorCode } from '../osm/overpass.ts'
import type { OsmData } from '../osm/types.ts'
import { WalkGraph } from '../routing/graph.ts'
import { safetyContext, type SafetyContext } from '../routing/safety.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import type { TileGrid } from '../tiles/grid.ts'

export type World = { data: OsmData; grid: TileGrid; graph: WalkGraph; safety: SafetyContext }

export function buildWorld(data: OsmData): World {
  const graph = new WalkGraph(data)
  return { data, grid: buildTileGrid(data), graph, safety: safetyContext(graph, data) }
}

export async function loadDemoWorld(): Promise<World> {
  const fixture = (await import('../data/benicalap.osm.json')).default as unknown as CompactOsm
  return buildWorld(decodeOsm(fixture))
}

export type LiveStatus =
  | { state: 'idle' }
  | { state: 'loading'; bytes: number }
  | { state: 'done'; fromCache: boolean }
  | { state: 'error'; code: OverpassErrorCode }

/** Holds the live Overpass client for the session (one per tab, so throttling works). */
export function useLiveLoader() {
  const client = useMemo(() => new OverpassClient({ cache: defaultCache() }), [])
  const [status, setStatus] = useState<LiveStatus>({ state: 'idle' })
  const busy = useRef(false)

  const load = useCallback(
    async (bbox: BBox): Promise<World | undefined> => {
      if (busy.current) return undefined
      busy.current = true
      setStatus({ state: 'loading', bytes: 0 })
      try {
        const { data, fromCache } = await client.loadArea(bbox, (bytes) => setStatus({ state: 'loading', bytes }))
        setStatus({ state: 'done', fromCache })
        return buildWorld(data)
      } catch (error) {
        setStatus({ state: 'error', code: error instanceof OverpassError ? error.code : 'network' })
        return undefined
      } finally {
        busy.current = false
      }
    },
    [client],
  )

  return { status, load }
}
