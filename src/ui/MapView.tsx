import { useEffect, useRef } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { useI18n } from '../i18n/index.ts'
import { MapRenderer, type Markers } from '../render/MapRenderer.ts'
import type { Route } from '../routing/planner.ts'
import type { TileGrid } from '../tiles/grid.ts'

type Props = {
  grid: TileGrid
  route: Route | undefined
  markers: Markers
  /** Points to frame when they change (route or markers). */
  focus: LatLon[]
  focusKey: string
  onTap: (p: LatLon) => void
  /** Where the walker stands (start point), for the "go to start" button. */
  home: LatLon | undefined
}

const TAP_SLOP_PX = 8

export function MapView({ grid, route, markers, focus, focusKey, onTap, home }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MapRenderer | undefined>(undefined)
  const onTapRef = useRef(onTap)
  const focusRef = useRef(focus)

  useEffect(() => {
    onTapRef.current = onTap
    focusRef.current = focus
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new MapRenderer(canvas, grid)
    rendererRef.current = renderer
    renderer.requestRender()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => renderer.requestRender())
    observer?.observe(canvas)

    // Pointer gestures: one finger pans, two fingers pinch, a short tap places a point.
    const pointers = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinchStart = 0
    let pinchZoom = renderer.zoom
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
      if (pointers.size === 1) moved = 0
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
        pinchZoom = renderer.zoom
        moved = TAP_SLOP_PX + 1
      }
    }
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const now = local(e)
      pointers.set(e.pointerId, now)
      if (pointers.size === 1) {
        moved += Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y)
        if (moved > TAP_SLOP_PX) renderer.panBy(now.x - prev.x, now.y - prev.y)
      } else if (pointers.size === 2 && pinchStart > 0) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / pinchStart
        const target = pinchZoom * ratio
        if (target > renderer.zoom * 1.4) renderer.zoomStep(1, (a.x + b.x) / 2, (a.y + b.y) / 2)
        else if (target < renderer.zoom / 1.4) renderer.zoomStep(-1, (a.x + b.x) / 2, (a.y + b.y) / 2)
      }
    }
    const up = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      if (p && pointers.size === 0 && moved <= TAP_SLOP_PX && e.type === 'pointerup') {
        onTapRef.current(renderer.screenToLatLon(p.x, p.y))
      }
      if (pointers.size < 2) pinchStart = 0
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      renderer.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer?.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
      renderer.dispose()
      rendererRef.current = undefined
    }
  }, [grid])

  useEffect(() => {
    rendererRef.current?.setRoute(route)
  }, [route, grid])

  useEffect(() => {
    rendererRef.current?.setMarkers(markers)
  }, [markers, grid])

  useEffect(() => {
    const renderer = rendererRef.current
    const points = focusRef.current
    if (!renderer || points.length === 0) return
    if (points.length === 1) renderer.centerOn(points[0]!, 24)
    else renderer.fit(points)
  }, [focusKey, grid])

  const zoom = (dir: 1 | -1) => rendererRef.current?.zoomStep(dir)
  const goHome = () => {
    if (home) rendererRef.current?.centerOn(home, 32)
  }
  const fit = () => {
    const r = rendererRef.current
    if (r && focusRef.current.length) r.fit(focusRef.current)
  }

  return (
    <div className="map">
      <canvas ref={canvasRef} className="map-canvas" data-testid="map-canvas" />
      <div className="map-buttons">
        <button type="button" className="pix-btn small" onClick={() => zoom(1)} aria-label={t('map.zoomIn')}>
          +
        </button>
        <button type="button" className="pix-btn small" onClick={() => zoom(-1)} aria-label={t('map.zoomOut')}>
          −
        </button>
        <button type="button" className="pix-btn small" onClick={fit} aria-label={t('map.fit')} title={t('map.fit')}>
          ◎
        </button>
        <button type="button" className="pix-btn small" onClick={goHome} aria-label={t('map.home')} title={t('map.home')}>
          ⌂
        </button>
      </div>
      <div className="map-attribution">{t('map.attribution')}</div>
    </div>
  )
}
