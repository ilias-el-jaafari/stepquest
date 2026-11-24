import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { bboxContains, type BBox, type LatLon } from '../geo/geo.ts'
import { formatCoordPair } from '../geo/coords.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { defaultCache } from '../osm/cache.ts'
import { areaForWalk } from '../osm/overpass.ts'
import { locateOnce } from '../quest/geolocation.ts'
import { routeNearBbox } from '../quest/migrate.ts'
import type { QuestState } from '../quest/quest.ts'
import { clearQuest, loadQuest } from '../quest/storage.ts'
import { AUTO_LOAD_SETTLE_MS, shouldAutoLoad } from '../ui/autoLoad.ts'
import { loadDemoWorld, useLiveLoader, type World } from '../ui/useMapData.ts'
import { cellKey, cellOf } from '../world/cells.ts'
import type { CellRecord } from '../world/slice.ts'
import type { AppAction, AppState } from './appState.ts'
import { VectorTileClient } from '../vector/client.ts'
import { IDLE_LOAD, type MapLoad } from '../world/streamer.ts'
import { useStreaming } from './useStreaming.ts'

type Args = {
  state: AppState
  latest: RefObject<AppState>
  dispatch: (action: AppAction) => void
  /** Starts a quest (here: the one saved before a reload). */
  beginQuest: (q: QuestState, resumed?: boolean) => void
  /** A quest is on screen: the map must not be replaced under it. */
  questActive: boolean
  /** Route on screen (quest or plan): its cells are never evicted while streaming. */
  keep?: readonly LatLon[]
  online?: boolean
  /** The self-playing demo: the bundled area only, no saved quest, no location, no downloads. */
  demo?: boolean
}

/** A world built from the bundled extract, not from a live download. */
const isDemoWorld = (w: World) => w.data.source === 'fixture'

/**
 * The box the map can show without replacing the world: the frame of a streamed world (cells in it
 * load as the view moves), or the box of a single extract.
 */
export const worldBox = (w: World): BBox => (w.live ? w.grid.bbox : w.data.bbox)

/**
 * Bring the cached cells under a saved route into a streamed world before deciding whether the quest
 * fits it (a route can reach beyond the bundled demo into cells streamed earlier). Cache only.
 */
async function withRouteCells(w: World, route: readonly LatLon[], cached: (c: { i: number; j: number }) => Promise<CellRecord | undefined>): Promise<World> {
  const live = w.live
  if (!live) return w
  const seen = new Set<string>()
  const records: CellRecord[] = []
  for (const p of route) {
    const c = cellOf(p)
    if (seen.has(cellKey(c)) || !live.needs(c)) continue
    seen.add(cellKey(c))
    const r = await cached(c).catch(() => undefined)
    if (r) records.push(r)
  }
  return live.add(records).length ? live.world() : w
}

/**
 * Which map is loaded and how it changes: the demo area at start-up (or the area of a saved
 * quest), live downloads around a point, "use my location", and loading the area the map was
 * moved to. Every function reads the newest state from `latest`, so none of them goes stale.
 */
export function useArea({ state, latest, dispatch, beginQuest, questActive, keep, online = true, demo = false }: Args) {
  const [world, setWorldState] = useState<World>()
  const worldRef = useRef<World>(undefined)
  const setWorld = useCallback((w: World) => {
    worldRef.current = w
    setWorldState(w)
  }, [])
  const live = useLiveLoader()
  const liveLoad = live.load
  const client = live.client
  // Cells arriving give a new snapshot of the same streamed world; one that was replaced meanwhile is ignored.
  const onStreamed = useCallback(
    (w: World) => {
      if (worldRef.current?.live === w.live) setWorld(w)
    },
    [setWorld],
  )
  const [load, setLoad] = useState<MapLoad>(IDLE_LOAD)
  // With a route planned or a quest running the frame follows the view; otherwise a view that rests
  // outside it gets the "load this area" behaviour below (requirement 20.17).
  const reanchor = !!state.result?.ok || questActive
  const tiles = useMemo(() => new VectorTileClient({ cache: defaultCache() }), [])
  useEffect(() => () => tiles.dispose(), [tiles])
  const onViewBox = useStreaming({ world, tiles, graph: client, onWorld: onStreamed, keep, online, onLoad: setLoad, reanchor, enabled: demo ? false : undefined })

  /** Load the live OSM area around a point and make it the start. */
  const loadLiveAround = useCallback(
    async (coords: LatLon): Promise<boolean> => {
      const { settings } = latest.current
      const box = areaForWalk(coords, stepsToMetres(settings.targetSteps, settings.strideM))
      const w = await liveLoad(box)
      if (!w) return false
      setWorld(w)
      dispatch({ type: 'areaLoaded', box, at: coords })
      return true
    },
    [latest, dispatch, liveLoad, setWorld],
  )

  /** `loaded` is the world just loaded at start-up (state is not updated yet then). */
  const locateMe = useCallback(
    async (loaded?: World) => {
      const current = loaded ?? worldRef.current
      dispatch({ type: 'locate', status: { state: 'locating' } })
      const res = await locateOnce()
      if (!res.ok) {
        dispatch({ type: 'locate', status: { state: 'error', code: res.code, accuracy: res.fix?.accuracy } })
        return
      }
      const p = { lat: res.fix.lat, lon: res.fix.lon }
      dispatch({ type: 'coords', text: formatCoordPair(p) })
      if (current && bboxContains(worldBox(current), p)) {
        dispatch({ type: 'located', p })
      } else {
        dispatch({ type: 'locate', status: { state: 'loadingArea' } })
        if (!(await loadLiveAround(p))) {
          dispatch({ type: 'locate', status: { state: 'idle' } })
          return
        }
      }
      dispatch({ type: 'locate', status: { state: 'ok', accuracy: res.fix.accuracy, weak: res.weak } })
    },
    [dispatch, loadLiveAround],
  )
  const locateRef = useRef(locateMe)
  useEffect(() => {
    locateRef.current = locateMe
  })

  // On start-up: resume a saved quest (bringing back its map), else load the demo area.
  const boot = useCallback(async () => {
    dispatch({ type: 'mapStatus', status: 'loading' })
    try {
      const saved = demo ? undefined : loadQuest(Date.now())
      let w: World | undefined
      if (saved?.area.kind === 'live') {
        w = await liveLoad(saved.area.bbox)
        if (w) dispatch({ type: 'liveRestored', box: saved.area.bbox })
      }
      w ??= await loadDemoWorld()
      if (saved) w = await withRouteCells(w, saved.route.points, (c) => client.cachedCell(c))
      setWorld(w)
      dispatch({ type: 'mapStatus', status: 'ready' })
      // Resume only on a map that holds the route (a quest saved on another map, or on a demo
      // extract that changed, is not drawn on the wrong one). A live map that failed to load is
      // kept for next time, and the user is told.
      const mapFits = !!saved && routeNearBbox(saved.route, w.data.bbox)
      if (saved && mapFits && (saved.area.kind === 'demo' || !isDemoWorld(w))) {
        dispatch({ type: 'resumed' })
        beginQuest(saved, true)
        return
      }
      if (demo) return
      if (saved?.area.kind === 'live') dispatch({ type: 'resumeFailed' })
      if (saved && saved.area.kind === 'demo' && !mapFits) clearQuest()
      // No quest to resume: load the map around the walker when location is already allowed,
      // otherwise offer it (the browser asks for permission on that tap).
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => undefined)
      if (permission?.state === 'granted') void locateRef.current(w)
      else if (permission?.state !== 'denied') dispatch({ type: 'askHere', on: true })
    } catch {
      dispatch({ type: 'mapStatus', status: 'failed' })
    }
  }, [dispatch, liveLoad, beginQuest, setWorld, client, demo])
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void boot()
  }, [boot])

  const loadView = useCallback(async () => {
    const centre = latest.current.viewCentre
    if (centre) await loadLiveAround(centre)
  }, [latest, loadLiveAround])

  const backToDemo = useCallback(async () => {
    try {
      setWorld(await loadDemoWorld())
      dispatch({ type: 'demo' })
    } catch {
      dispatch({ type: 'mapStatus', status: 'failed' })
    }
  }, [dispatch, setWorld])

  // Resting the map outside the loaded area loads it, when no route would be lost. One request at a
  // time, after the map has settled; a failed spot is not retried until the view moves away (the
  // Overpass client also waits at least 10 s between requests).
  const failedAt = useRef<LatLon>(undefined)
  const bbox = world ? worldBox(world) : undefined
  const { viewCentre } = state
  const hasPlan = !!state.result?.ok || questActive
  const busy = live.status.state === 'loading' || state.locate.state === 'locating' || state.locate.state === 'loadingArea'
  useEffect(() => {
    if (demo || !bbox || !viewCentre) return
    if (!shouldAutoLoad({ bbox, centre: viewCentre, busy, hasPlan, failedAt: failedAt.current })) return
    const timer = setTimeout(() => {
      void loadLiveAround(viewCentre).then((ok) => {
        if (!ok) failedAt.current = viewCentre
      })
    }, AUTO_LOAD_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [bbox, viewCentre, busy, hasPlan, loadLiveAround, demo])

  return { world, live, locateMe, loadLiveAround, loadView, backToDemo, retryBoot: boot, onViewBox, load }
}
