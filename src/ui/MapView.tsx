import { memo, useEffect, useRef, useState } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import { useI18n } from '../i18n/index.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { parseTimeParam } from '../render/daylight.ts'
import { MapRenderer, type Markers, type QuestOverlay, type RouteShape } from '../render/MapRenderer.ts'
import type { MapSource } from '../render/mapSource.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { walkerFor } from '../hero/look.ts'
import { useLook } from '../hero/useLook.ts'
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
  /** Height an overlaying HUD takes at the bottom of the map (px), so the buttons stay clear of it. */
  bottomReserve?: number
  /** Where the view is after every move (pan, zoom, follow), for streaming the cells around it. */
  onViewBox?: (box: BBox, centre: LatLon) => void
}

/**
 * Memoised on purpose: the screen around it re-renders on every keystroke and every clock tick,
 * and the map only needs to follow its own props (callers pass stable callbacks and objects).
 */
export const MapView = memo(function MapView({ map, route, markers, focus, focusKey, onTap, home, quest, follow, pickup, onUserPan, avoided, onLocate, locating, onView, bubble, bottomReserve, onViewBox }: Props) {
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
    renderer.onViewChange((box, centre) => onViewBoxRef.current?.(box, centre))
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
  }, [map])

  useEffect(() => {
    rendererRef.current?.setRoute(route)
  }, [route, map])

  const look = useLook()
  useEffect(() => {
    rendererRef.current?.setWalker(walkerFor(look))
  }, [look, map])

  useEffect(() => {
    rendererRef.current?.setMarkers(markers)
  }, [markers, map])

  useEffect(() => {
    rendererRef.current?.setAvoided(avoided ?? [])
  }, [avoided, map])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setQuest(quest)
    if (follow && quest?.player) r.follow(quest.player)
  }, [quest, follow, map])

  useEffect(() => {
    rendererRef.current?.setBubble(bubble)
  }, [bubble, map])

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
      <canvas ref={canvasRef} className="map-canvas" data-testid="map-canvas" tabIndex={0} role="application" aria-label={t('map.canvas')} />
      <div className="map-buttons" data-columns={plan.columns} style={{ '--stack-rows': plan.rows } as React.CSSProperties}>
        {plan.shown.map(button)}
        {hasMore && (
          <button type="button" className="pix-btn round" onClick={() => setMoreOpen((o) => !o)} aria-label={t('map.more')} title={t('map.more')} aria-expanded={moreOpen} data-testid="map-more">
            <PixelIcon name="more" />
          </button>
        )}
        {hasMore && moreOpen && <div className="map-more" data-testid="map-more-row">{plan.more.map(button)}</div>}
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        {t('map.attribution')}
      </a>
    </div>
  )
})
