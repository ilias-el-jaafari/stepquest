import { useEffect, useRef } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { useI18n } from '../i18n/index.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { parseTimeParam } from '../render/daylight.ts'
import { MapRenderer, type Markers, type QuestOverlay, type RouteShape } from '../render/MapRenderer.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { walkerFor } from '../hero/look.ts'
import { useLook } from '../hero/useLook.ts'
import { attachMapInput } from './mapInput.ts'

type Props = {
  grid: TileGrid
  route: RouteShape | undefined
  markers: Markers
  /** Points to frame when they change (route or markers). */
  focus: LatLon[]
  focusKey: string
  onTap: (p: LatLon) => void
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
}

export function MapView({ grid, route, markers, focus, focusKey, onTap, home, quest, follow, pickup, onUserPan, avoided, onLocate, locating, onView, bubble }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MapRenderer | undefined>(undefined)
  const onTapRef = useRef(onTap)
  const focusRef = useRef(focus)
  const onUserPanRef = useRef(onUserPan)
  const onViewRef = useRef(onView)

  useEffect(() => {
    onTapRef.current = onTap
    focusRef.current = focus
    onUserPanRef.current = onUserPan
    onViewRef.current = onView
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new MapRenderer(canvas, grid)
    rendererRef.current = renderer
    // `?time=19:45` previews the lighting at that local time (screenshots, demo video).
    if (typeof location !== 'undefined') renderer.setClockOverride(parseTimeParam(location.search))
    renderer.requestRender()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => renderer.requestRender())
    observer?.observe(canvas)

    const detach = attachMapInput(canvas, renderer, () => ({
      tap: (p) => onTapRef.current(p),
      userPan: () => onUserPanRef.current?.(),
      view: (c) => onViewRef.current?.(c),
    }))
    return () => {
      observer?.disconnect()
      detach()
      renderer.dispose()
      rendererRef.current = undefined
    }
  }, [grid])

  useEffect(() => {
    rendererRef.current?.setRoute(route)
  }, [route, grid])

  const look = useLook()
  useEffect(() => {
    rendererRef.current?.setWalker(walkerFor(look))
  }, [look, grid])

  useEffect(() => {
    rendererRef.current?.setMarkers(markers)
  }, [markers, grid])

  useEffect(() => {
    rendererRef.current?.setAvoided(avoided ?? [])
  }, [avoided, grid])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setQuest(quest)
    if (follow && quest?.player) r.follow(quest.player)
  }, [quest, follow, grid])

  useEffect(() => {
    rendererRef.current?.setBubble(bubble)
  }, [bubble, grid])

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
  }, [focusKey, grid])

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

  return (
    <div className="map">
      <canvas ref={canvasRef} className="map-canvas" data-testid="map-canvas" tabIndex={0} role="application" aria-label={t('map.canvas')} />
      <div className="map-buttons">
        <button type="button" className="pix-btn round" onClick={() => zoom(1)} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>
          <PixelIcon name="plus" />
        </button>
        <button type="button" className="pix-btn round" onClick={() => zoom(-1)} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>
          <PixelIcon name="minus" />
        </button>
        {!inQuest && (
          <>
            <button type="button" className="pix-btn round" onClick={fit} aria-label={t('map.fit')} title={t('map.fit')}>
              <PixelIcon name="fit" />
            </button>
            <button type="button" className="pix-btn round" onClick={goHome} aria-label={t('map.home')} title={t('map.home')}>
              <PixelIcon name="home" />
            </button>
          </>
        )}
        {(onLocate || inQuest) && (
          <button
            type="button"
            className="pix-btn round"
            onClick={locate}
            disabled={locating}
            aria-label={inQuest ? t('map.me') : t('loc.use')}
            title={inQuest ? t('map.me') : t('loc.use')}
            data-testid="map-locate"
          >
            <PixelIcon name="locate" />
          </button>
        )}
      </div>
      <div className="map-attribution">{t('map.attribution')}</div>
    </div>
  )
}
