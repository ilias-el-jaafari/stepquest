import { useCallback, useEffect, useRef } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import type { CellClient } from '../world/streamer.ts'
import { Streamer } from '../world/streamer.ts'
import type { World } from '../world/liveWorld.ts'

/** Streaming is off under Vitest: tests never send a request (a test can still pass `enabled`). */
export const STREAMING_ENABLED = import.meta.env.MODE !== 'test'

type Args = {
  world: World | undefined
  client: CellClient
  /** The newest snapshot of the streamed world (cells arrived). */
  onWorld: (w: World) => void
  /** Route points (the active quest or the planned route): their cells are never evicted. */
  keep: readonly LatLon[] | undefined
  online: boolean
  enabled?: boolean
}

/**
 * Runs a `Streamer` for the streamed world on screen (requirement 19): the map reports its view box,
 * cells around it load, and each arrival hands the app a new snapshot of the same world (same grid,
 * so the map view and an active quest are not rebuilt). Returns the callback for the map's view.
 */
export function useStreaming({ world, client, onWorld, keep, online, enabled = STREAMING_ENABLED }: Args) {
  const live = world?.live
  const streamer = useRef<Streamer | undefined>(undefined)
  const keepRef = useRef(keep)
  const onWorldRef = useRef(onWorld)
  useEffect(() => {
    keepRef.current = keep
    onWorldRef.current = onWorld
  })

  useEffect(() => {
    if (!live || !enabled) return
    const s = new Streamer({ client, world: live, keep: () => keepRef.current ?? [], onChange: () => onWorldRef.current(live.world()) })
    streamer.current = s
    return () => {
      s.dispose()
      if (streamer.current === s) streamer.current = undefined
      live.setLoading([])
    }
  }, [live, client, enabled])

  useEffect(() => {
    if (online) streamer.current?.retry()
  }, [online])

  return useCallback((box: BBox, centre: LatLon) => streamer.current?.setView(box, centre), [])
}
