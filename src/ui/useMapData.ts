import { useCallback, useMemo, useRef, useState } from 'react'
import type { BBox } from '../geo/geo.ts'
import { decodeOsm, type CompactOsm } from '../osm/codec.ts'
import { defaultCache } from '../osm/cache.ts'
import { OverpassClient, OverpassError, type OverpassErrorCode } from '../osm/overpass.ts'
import type { OsmData } from '../osm/types.ts'
import { WalkGraph } from '../routing/graph.ts'
import { safetyContext } from '../routing/safety.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { LiveWorld, type World } from '../world/liveWorld.ts'

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
        return streamedWorld(data)
      } catch (error) {
        setStatus({ state: 'error', code: error instanceof OverpassError ? error.code : 'network' })
        return undefined
      } finally {
        busy.current = false
      }
    },
    [client],
  )

  return { status, load, client }
}
