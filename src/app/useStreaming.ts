import { useCallback, useEffect, useRef } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import type { TileSource } from '../vector/client.ts'
import type { GraphClient, LodCoverage, MapLoad } from '../world/streamer.ts'
import { IDLE_LOAD, Streamer } from '../world/streamer.ts'
import type { World } from '../world/liveWorld.ts'

/** Streaming is off under Vitest: tests never send a request (a test can still pass `enabled`). */
export const STREAMING_ENABLED = import.meta.env.MODE !== 'test'

type Args = {
  world: World | undefined
  /** Vector tiles: everything the map draws (requirement 21). */
  tiles: TileSource
  /** Overpass cells for the walking graph along the route (never for drawing). */
  graph?: GraphClient
  /** The newest snapshot of the streamed world (cells arrived). */
  onWorld: (w: World) => void
  /** Route points (the active quest or the planned route): their cells are never evicted. */
  keep: readonly LatLon[] | undefined
  online: boolean
  enabled?: boolean
  /** What the map shows now (requirement 20.15). */
  onLoad?: (load: MapLoad) => void
  /** The frame may follow the view (a route is planned or a quest runs; requirement 20.17). */
  reanchor?: boolean
  /** The level-of-detail layer: far cells it covers need no coarse tiles (requirement 25.10). */
  lod?: LodCoverage
}

/**
 * Runs a `Streamer` for the streamed world on screen (requirements 19 to 21): the map reports its view box,
 * the vector tiles under it load, and each arrival hands the app a new snapshot of the same world (same grid,
 * so the map view and an active quest are not rebuilt). Returns the callback for the map's view.
 */
export function useStreaming({ world, tiles, graph, onWorld, keep, online, enabled = STREAMING_ENABLED, onLoad, reanchor = false, lod }: Args) {
  const live = world?.live
  const streamer = useRef<Streamer | undefined>(undefined)
  const keepRef = useRef(keep)
  const onWorldRef = useRef(onWorld)
  const onLoadRef = useRef(onLoad)
  const reanchorRef = useRef(reanchor)
  useEffect(() => {
    keepRef.current = keep
    onWorldRef.current = onWorld
    onLoadRef.current = onLoad
    reanchorRef.current = reanchor
  })

  useEffect(() => {
    if (!live || !enabled) return
    const s = new Streamer({ tiles, graph, world: live, keep: () => keepRef.current ?? [], onChange: () => onWorldRef.current(live.world()), onLoad: (l) => onLoadRef.current?.(l), reanchor: () => reanchorRef.current, lod })
    streamer.current = s
    return () => {
      s.dispose()
      if (streamer.current === s) streamer.current = undefined
      live.setLoading([])
      onLoadRef.current?.(IDLE_LOAD)
    }
  }, [live, tiles, graph, enabled, lod])

  useEffect(() => {
    if (online) streamer.current?.retry()
  }, [online])

  return useCallback((box: BBox, centre: LatLon, zoom?: number) => streamer.current?.setView(box, centre, zoom), [])
}
