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
import { cellKey, cellOf, cellsInBBox } from '../world/cells.ts'
import { enrichFromOverpass, type WalkProgress } from '../world/walkArea.ts'
import type { CellRecord } from '../world/slice.ts'
import type { AppAction, AppState } from './appState.ts'
import { VectorTileClient } from '../vector/client.ts'
import { IDLE_LOAD, type MapLoad } from '../world/streamer.ts'
import { useLod } from './useLod.ts'
import { STREAMING_ENABLED, useStreaming } from './useStreaming.ts'

/** A start that rests this long (a tap, a fix) starts loading its streets. */
const WALK_PREFETCH_DELAY_MS = 600

/** What a plan needs on the device: the start, the finish for A → B, and the goal that sets the size of the walk. */
export type WalkNeed = { start: LatLon; end?: LatLon; targetSteps: number; strideM: number }

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
  /** The centre of the detail radius (requirement 25): the walker in a quest, else the planner's start. */
  hero?: LatLon
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
export function useArea({ state, latest, dispatch, beginQuest, questActive, keep, online = true, demo = false, hero }: Args) {
  const [world, setWorldState] = useState<World>()
  const worldRef = useRef<World>(undefined)
  const setWorld = useCallback((w: World) => {
    worldRef.current = w
    setWorldState(w)
  }, [])
  const tiles = useMemo(() => new VectorTileClient({ cache: defaultCache() }), [])
  useEffect(() => () => tiles.dispose(), [tiles])
  const live = useLiveLoader(tiles)
  const liveLoad = live.load
  const liveGrow = live.grow
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
  const lod = useLod({ tiles, hero, online, enabled: demo ? false : undefined })
  const streamView = useStreaming({ world, tiles, graph: client, onWorld: onStreamed, keep, online, onLoad: setLoad, reanchor, enabled: demo ? false : undefined, lod: lod.layer })
  const lodView = lod.onView
  const onViewBox = useCallback(
    (box: BBox, centre: LatLon, zoom?: number) => {
      streamView(box, centre, zoom)
      lodView(box, centre)
    },
    [streamView, lodView],
  )

  /** Overpass adds lit, sidewalk and name tags to the streets of the cells, from the device first (requirement 23.5). Never waited for. */
  const enrichAround = useCallback(
    (w: World, box: BBox) => {
      const lv = w.live
      if (!lv) return
      void enrichFromOverpass(cellsInBBox(box), client, lv, { network: STREAMING_ENABLED, changed: () => onStreamed(lv.world()) })
    },
    [client, onStreamed],
  )

  /**
   * Make sure the walking graph covers the start (and the finish): nothing to do when their cells are in
   * the graph (the bundled extract included); else load the cells of the walk from tiles, into the world on
   * screen when they are in its frame, else into a new world centred on the walk. Joins a load already
   * running. Throws `WalkAreaError`. Resolves with the world to plan on.
   */
  const ensureWalk = useCallback(
    async (need: WalkNeed, onProgress?: (p: WalkProgress) => void): Promise<World | undefined> => {
      const w = worldRef.current
      const lv = w?.live
      if (!w || !lv) return w
      const covered = (p: LatLon) => lv.hasGraph(cellOf(p))
      if (covered(need.start) && (!need.end || covered(need.end))) return w
      const box = areaForWalk(need.start, stepsToMetres(need.targetSteps, need.strideM), need.end)
      const cells = cellsInBBox(box)
      let next: World
      if (cells.every((c) => lv.inFrame(c))) {
        next = await liveGrow(
          lv,
          cells.filter((c) => !lv.hasGraph(c)),
          onProgress,
        )
        if (worldRef.current?.live === lv) setWorld(next)
      } else {
        next = await liveLoad(box, onProgress)
        setWorld(next)
      }
      dispatch({ type: 'areaGrown', box })
      enrichAround(next, box)
      return next
    },
    [liveGrow, liveLoad, setWorld, dispatch, enrichAround],
  )

  /** The area a plan from the newest state needs. */
  const needNow = useCallback((): WalkNeed => {
    const s = latest.current
    return { start: s.start, end: s.settings.mode === 'oneway' ? s.end : undefined, targetSteps: s.settings.targetSteps, strideM: s.settings.strideM }
  }, [latest])

  /** Load the live OSM area around a point and make it the start. */
  const loadLiveAround = useCallback(
    async (coords: LatLon): Promise<boolean> => {
      const { settings } = latest.current
      const box = areaForWalk(coords, stepsToMetres(settings.targetSteps, settings.strideM))
      try {
        const w = await liveLoad(box)
        setWorld(w)
        dispatch({ type: 'areaLoaded', box, at: coords })
        enrichAround(w, box)
        return true
      } catch {
        return false
      }
    },
    [latest, dispatch, liveLoad, setWorld, enrichAround],
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
      // The start is the fix, whatever the map holds; the streets around it come next (requirement 6e).
      dispatch({ type: 'located', p })
      const covered = current ? (current.live ? current.live.hasGraph(cellOf(p)) : bboxContains(worldBox(current), p)) : false
      if (!covered) {
        dispatch({ type: 'locate', status: { state: 'loadingArea' } })
        try {
          await ensureWalk({ ...needNow(), start: p, end: undefined })
        } catch {
          dispatch({ type: 'locate', status: { state: 'areaError' } })
          return
        }
      }
      dispatch({ type: 'locate', status: { state: 'ok', accuracy: res.fix.accuracy, weak: res.weak } })
    },
    [dispatch, ensureWalk, needNow],
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
        w = await liveLoad(saved.area.bbox).catch(() => undefined)
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

  // Prefetch (requirement 6e.2): as soon as the start is known, load the streets the plan will need, so the plan button
  // usually finds them. A start that failed to load is not tried again until it, the finish or the goal changes.
  const failedWalk = useRef<string>(undefined)
  const { start, end } = state
  const { mode, targetSteps, strideM } = state.settings
  const ready = !!world
  useEffect(() => {
    if (demo || !STREAMING_ENABLED || !ready || !online) return
    const key = `${start.lat},${start.lon},${mode === 'oneway' ? `${end?.lat},${end?.lon}` : ''},${targetSteps},${strideM}`
    if (failedWalk.current === key) return
    const timer = setTimeout(() => {
      ensureWalk(needNow()).catch(() => {
        failedWalk.current = key
      })
    }, WALK_PREFETCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [demo, ready, online, start, end, mode, targetSteps, strideM, ensureWalk, needNow])

  return { world, live, ensureWalk, locateMe, loadLiveAround, loadView, backToDemo, retryBoot: boot, onViewBox, load, lod }
}
