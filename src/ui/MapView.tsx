import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import { useI18n } from '../i18n/index.ts'
import { DEMO_CLOSE_ZOOM } from '../demo/script.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { parseTimeParam } from '../render/daylight.ts'
import { decorOn, subscribeDecor } from '../decor/pref.ts'
import { MapRenderer, type Markers, type QuestOverlay, type RouteShape } from '../render/MapRenderer.ts'
import { isMapSource, type MapSource } from '../render/mapSource.ts'
import type { MapLoad } from '../world/streamer.ts'
import { PAN_REACH_M } from '../lod/config.ts'
import type { TileGrid } from '../tiles/grid.ts'
import type { SightMark } from '../sights/types.ts'
import { walkerFor } from '../hero/look.ts'
import { useLook } from '../hero/useLook.ts'
import type { LodLayer } from '../lod/layer.ts'
import { attachMapInput } from './mapInput.ts'
import { planStack, type StackId } from './mapStack.ts'

type Props = {
  /** The map: one extract's grid, or a streamed world that grows (it is never replaced while it grows). */
  map: TileGrid | MapSource
  route: RouteShape | undefined
  markers: Markers
  /** Points to frame when they change (route or markers). */
  focus: LatLon[]
  focusKey: string
  /** A tap on the map: the point and the zoom it was made at (the reach of a street snap depends on it). */
  onTap: (p: LatLon, zoom: number) => void
  /** The level-of-detail layer around the hero; absent when it is off. */
  lod?: LodLayer
  /** The sights along the route (landmarks spec); drawn as buildings, with names at quest zoom. */
  sights?: readonly SightMark[]
  /** The map follows the view, so the camera may roam `PAN_REACH_M` around the hero (the walker, else `home`) instead of staying near the frame. */
  roam?: boolean
  /** Where the walker stands (start point), for the "go to start" button. */
  home: LatLon | undefined
  /** Active quest overlay (walker position, progress). */
  quest?: QuestOverlay
  /** Camera follows the walker. */
  follow?: boolean
  /** Bump `n` to play the pickup animation at `point`. */
  pickup?: { n: number; point: LatLon }
  /** Called when the user drags the map (so follow mode can switch off). */
  onUserPan?: () => void
  /** Streets on the avoid list, drawn as hazard tape. */
  avoided?: readonly (readonly LatLon[])[]
  /** Shows a "use my location" button. During a quest it centres on the walker and then calls this. */
  onLocate?: () => void
  locating?: boolean
  /** The map centre after the user pans or zooms (to offer loading that area). */
  onView?: (centre: LatLon) => void
  /** The phrase being spoken, drawn as a speech bubble next to the walker. */
  bubble?: string
  /** Height an overlaying HUD takes at the bottom of the map (px), so the buttons stay clear of it. */
  bottomReserve?: number
  /** Where the view is after every move (pan, zoom, follow), for streaming the cells around it. */
  onViewBox?: (box: BBox, centre: LatLon, zoom?: number) => void
  /** What the map shows now; set as `data-map-ready` and `data-map-pending` on the canvas (no visible change). */
  load?: MapLoad
  /** The demo run's day-cycle moment (epoch ms); wins over `?time=`. */
  clockAt?: number
  /** The demo run's camera: blend 0 is close on the walker, 1 shows the whole `bounds`. */
  shot?: { blend: number; bounds: BBox }
}

/**
 * Memoised on purpose: the screen around it re-renders on every keystroke and every clock tick,
 * and the map only needs to follow its own props (callers pass stable callbacks and objects).
 */
export const MapView = memo(function MapView({ map, route, markers, focus, focusKey, onTap, lod, roam, home, quest, follow, pickup, onUserPan, avoided, sights, onLocate, locating, onView, bubble, bottomReserve, onViewBox, load, clockAt, shot }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [moreOpen, setMoreOpen] = useState(false)
  const rendererRef = useRef<MapRenderer | undefined>(undefined)
  const onTapRef = useRef(onTap)
  const focusRef = useRef(focus)
  const onUserPanRef = useRef(onUserPan)
  const onViewRef = useRef(onView)
  const onViewBoxRef = useRef(onViewBox)
  // Where the camera may roam around: the walker in a quest, else the start (requirement 26.1).
  const reachSource = roam ? (quest?.player ?? home) : undefined
  const reachLat = reachSource?.lat
  const reachLon = reachSource?.lon
  const reachAt = useMemo(() => (reachLat === undefined || reachLon === undefined ? undefined : { lat: reachLat, lon: reachLon }), [reachLat, reachLon])
  const roamRef = useRef(reachAt)
  // A streamed world can move its frame (a new grid) when the view leaves it: rebuild the renderer then,
  // at the same place and zoom (requirement 20.17).
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!isMapSource(map) || !map.subscribeFrame) return
    const stop = map.subscribeFrame(() => setFrame((f) => f + 1))
    return () => void stop()
  }, [map])
  const carry = useRef<{ map: TileGrid | MapSource; at: LatLon; zoom: number } | undefined>(undefined)

  useEffect(() => {
    onTapRef.current = onTap
    focusRef.current = focus
    onUserPanRef.current = onUserPan
    onViewRef.current = onView
    onViewBoxRef.current = onViewBox
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new MapRenderer(canvas, map)
    rendererRef.current = renderer
    renderer.setReach(roamRef.current, PAN_REACH_M)
    const kept = carry.current
    if (kept && kept.map === map) renderer.centerOn(kept.at, kept.zoom)
    carry.current = undefined
    renderer.onViewChange((box, centre, zoom) => onViewBoxRef.current?.(box, centre, zoom))
    // `?time=19:45` previews the lighting at that local time (screenshots, demo video).
    if (typeof location !== 'undefined') renderer.setClockOverride(parseTimeParam(location.search))
    renderer.setDecor(decorOn())
    renderer.requestRender()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => renderer.renderNow())
    observer?.observe(canvas)

    const detach = attachMapInput(canvas, renderer, () => ({
      tap: (p) => onTapRef.current(p, renderer.zoom),
      userPan: () => onUserPanRef.current?.(),
      view: (c) => onViewRef.current?.(c),
    }))
    return () => {
      carry.current = { map, at: renderer.screenToLatLon(renderer.cssWidth / 2, renderer.cssHeight / 2), zoom: renderer.zoom }
      observer?.disconnect()
      detach()
      renderer.dispose()
      rendererRef.current = undefined
    }
  }, [map, frame])

  useEffect(() => {
    roamRef.current = reachAt
    rendererRef.current?.setReach(reachAt, PAN_REACH_M)
  }, [reachAt, map, frame])

  useEffect(() => {
    rendererRef.current?.setLod(lod)
  }, [lod, map, frame])

  useEffect(() => {
    rendererRef.current?.setRoute(route)
  }, [route, map, frame])

  const look = useLook()
  useEffect(() => {
    rendererRef.current?.setWalker(walkerFor(look))
  }, [look, map, frame])

  useEffect(() => {
    rendererRef.current?.setMarkers(markers)
  }, [markers, map, frame])

  useEffect(() => {
    rendererRef.current?.setSights(sights ?? [])
  }, [sights, map, frame])

  useEffect(() => {
    rendererRef.current?.setAvoided(avoided ?? [])
  }, [avoided, map, frame])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setQuest(quest)
    if (follow && quest?.player) r.follow(quest.player)
    else r.stopFollow()
  }, [quest, follow, map, frame])

  useEffect(() => subscribeDecor(() => rendererRef.current?.setDecor(decorOn())), [])

  useEffect(() => {
    if (clockAt !== undefined) rendererRef.current?.setClockAt(clockAt)
  }, [clockAt, map, frame])

  useEffect(() => {
    rendererRef.current?.setBubble(bubble)
  }, [bubble, map, frame])

  // After the follow effect above, so the demo camera has the last word on the zoom and the centre.
  useEffect(() => {
    if (shot && quest?.player) rendererRef.current?.autoShot(quest.player, shot.bounds, shot.blend, DEMO_CLOSE_ZOOM)
    else rendererRef.current?.clearShot()
  }, [shot, quest, map, frame])

  const pickupN = pickup?.n ?? 0
  const pickupRef = useRef(pickup)
  useEffect(() => {
    pickupRef.current = pickup
  })
  useEffect(() => {
    const p = pickupRef.current
    if (p && p.n > 0) rendererRef.current?.pickup(p.point)
  }, [pickupN])

  useEffect(() => {
    const renderer = rendererRef.current
    const points = focusRef.current
    if (!renderer || points.length === 0) return
    if (points.length === 1) renderer.centerOn(points[0]!, 24)
    else renderer.fit(points)
  }, [focusKey, map])

  const zoom = (dir: 1 | -1) => rendererRef.current?.zoomStep(dir)
  const goHome = () => {
    const target = quest?.player ?? home
    if (target) rendererRef.current?.centerOn(target, 32)
  }
  const inQuest = quest !== undefined
  const locate = () => {
    if (inQuest) {
      // Always the walker's current position, never the start point.
      const r = rendererRef.current
      if (r && quest.player) r.centerOn(quest.player, Math.max(r.zoom, 32))
    }
    onLocate?.()
  }
  const fit = () => {
    const r = rendererRef.current
    if (r && focusRef.current.length) r.fit(focusRef.current)
  }

  // Re-plan the button stack whenever the map viewport changes size.
  useEffect(() => {
    const el = mapRef.current
    if (!el) return
    const read = () => setSize((o) => (o.width === el.clientWidth && o.height === el.clientHeight ? o : { width: el.clientWidth, height: el.clientHeight }))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const hasLocate = Boolean(onLocate) || inQuest
  const ids: StackId[] = inQuest ? ['zoomIn', 'zoomOut'] : ['zoomIn', 'zoomOut', 'fit', 'home']
  if (hasLocate) ids.push('locate')
  const plan = planStack({ width: size.width, height: size.height, ids, bottomReserve })
  const hasMore = plan.more.length > 0
  const buttons: Record<StackId, { label: string; icon: 'plus' | 'minus' | 'fit' | 'home' | 'locate'; run: () => void; disabled?: boolean; testId?: string }> = {
    zoomIn: { label: t('map.zoomIn'), icon: 'plus', run: () => zoom(1) },
    zoomOut: { label: t('map.zoomOut'), icon: 'minus', run: () => zoom(-1) },
    fit: { label: t('map.fit'), icon: 'fit', run: fit },
    home: { label: t('map.home'), icon: 'home', run: goHome },
    locate: { label: inQuest ? t('map.me') : t('loc.use'), icon: 'locate', run: locate, disabled: locating, testId: 'map-locate' },
  }
  const button = (id: StackId) => {
    const b = buttons[id]
    return (
      <button key={id} type="button" className="pix-btn round" onClick={b.run} disabled={b.disabled} aria-label={b.label} title={b.label} data-testid={b.testId}>
        <PixelIcon name={b.icon} />
      </button>
    )
  }

  return (
    <div className="map" ref={mapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        data-testid="map-canvas"
        data-map-ready={load?.ready ?? 'full'}
        data-map-pending={load?.pending ?? 0}
        tabIndex={0}
        role="application"
        aria-label={t('map.canvas')}
      />
      <div className="map-buttons" data-columns={plan.columns} style={{ '--stack-rows': plan.rows } as React.CSSProperties}>
        {plan.shown.map(button)}
        {hasMore && (
          <button type="button" className="pix-btn round" onClick={() => setMoreOpen((o) => !o)} aria-label={t('map.more')} title={t('map.more')} aria-expanded={moreOpen} data-testid="map-more">
            <PixelIcon name="more" />
          </button>
        )}
        {hasMore && moreOpen && <div className="map-more" data-testid="map-more-row">{plan.more.map(button)}</div>}
      </div>
      {/* Required credits (requirement 21.12): the map is drawn from OpenFreeMap tiles in the OpenMapTiles schema, made from OpenStreetMap data. */}
      {/* One inline span: the credit strip is a flex box, and a flex box drops the spaces between its items. */}
      <p className="map-attribution" data-testid="map-attribution">
        <span>
          <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
            {t('map.creditTiles')}
          </a>{' '}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
            {t('map.creditSchema')}
          </a>{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            {t('map.attribution')}
          </a>
        </span>
      </p>
    </div>
  )
})
