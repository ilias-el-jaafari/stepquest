import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import { lodRadiusFrom } from '../lod/config.ts'
import { LodFocus } from '../lod/focus.ts'
import { LodLayer, type SnapAnswer } from '../lod/layer.ts'
import type { Snap } from '../lod/snap.ts'
import { LodPrefetcher, SETTLE_MS } from '../lod/prefetch.ts'
import { LodStore } from '../lod/store.ts'
import type { LodSource } from '../vector/client.ts'

/** The level-of-detail layer is off under Vitest, like streaming: tests never send a request (a test can still pass `enabled`). */
export const LOD_ENABLED = import.meta.env.MODE !== 'test'

type Args = {
  tiles: LodSource
  /** The walker in a quest, else the planner's start: the centre of the detail radius. */
  hero: LatLon | undefined
  /** The A → B finish the player tapped: its surroundings get the full detail whatever the distance (requirement 26.3). */
  finish?: LatLon
  online: boolean
  enabled?: boolean
}

/**
 * The level of detail around the hero (requirement 25): the store and layer the map draws from, and the prefetcher that fills
 * them (cached tiles at once, then the view, then rings outward from the hero). `onView` is the map's view callback;
 * `snapAt` answers a tap with the street under it, `snapAnswer` also says when none is in reach.
 */
export function useLod({ tiles, hero, finish, online, enabled = LOD_ENABLED }: Args) {
  const store = useMemo(() => new LodStore(), [])
  const layer = useMemo(() => new LodLayer(store, lodRadiusFrom(typeof location === 'undefined' ? '' : location.search)), [store])
  const prefetcher = useRef<LodPrefetcher | undefined>(undefined)
  const heroRef = useRef(hero)
  const focus = useMemo(() => new LodFocus(), [])
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Hand the focus points to the layer (drawing) and the prefetcher (loading). */
  const publishFocus = useCallback(() => {
    layer.setFocus(focus.points())
    prefetcher.current?.setFocus(focus.points())
  }, [focus, layer])

  useEffect(() => {
    heroRef.current = hero
    layer.setHero(hero)
    prefetcher.current?.setHero(hero)
  }, [hero, layer])

  useEffect(() => {
    if (focus.pin(finish)) publishFocus()
  }, [finish, focus, publishFocus])

  useEffect(() => {
    if (!enabled) return
    const p = new LodPrefetcher({ source: tiles, store, radiusM: layer.radius })
    prefetcher.current = p
    p.setHero(heroRef.current)
    p.setFocus(focus.points())
    const visible = () => {
      if (typeof document !== 'undefined' && !document.hidden) p.retry()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      p.dispose()
      if (prefetcher.current === p) prefetcher.current = undefined
    }
  }, [enabled, tiles, store, layer, focus])

  useEffect(() => {
    if (online) prefetcher.current?.retry()
  }, [online])

  useEffect(() => () => store.dispose(), [store])

  // A view that rests beyond the reach of the hero's rings gets the full detail around it (requirement 26.3).
  const onView = useCallback(
    (box: BBox, centre: LatLon) => {
      if (!enabled) return
      prefetcher.current?.setView(box, centre)
      clearTimeout(rest.current)
      rest.current = setTimeout(() => {
        if (focus.view(centre, heroRef.current, layer.radius)) publishFocus()
      }, SETTLE_MS)
    },
    [enabled, focus, layer, publishFocus],
  )
  useEffect(() => () => clearTimeout(rest.current), [])
  const snapAt = useCallback((p: LatLon, zoom: number, metresPerTile: number): Snap | undefined => layer.snapAt(p, zoom, metresPerTile), [layer])
  const snapAnswer = useCallback((p: LatLon, zoom: number, metresPerTile: number): SnapAnswer => layer.snapAnswer(p, zoom, metresPerTile), [layer])
  return { layer: enabled ? layer : undefined, onView, snapAt, snapAnswer }
}
