import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { BBox, LatLon } from '../geo/geo.ts'
import { lodRadiusFrom } from '../lod/config.ts'
import { LodLayer } from '../lod/layer.ts'
import { LodPrefetcher } from '../lod/prefetch.ts'
import type { Snap } from '../lod/snap.ts'
import { LodStore } from '../lod/store.ts'
import type { LodSource } from '../vector/client.ts'

/** The level-of-detail layer is off under Vitest, like streaming: tests never send a request (a test can still pass `enabled`). */
export const LOD_ENABLED = import.meta.env.MODE !== 'test'

type Args = {
  tiles: LodSource
  /** The walker in a quest, else the planner's start: the centre of the detail radius. */
  hero: LatLon | undefined
  online: boolean
  enabled?: boolean
}

/**
 * The level of detail around the hero (requirement 25): the store and layer the map draws from, and the prefetcher that fills
 * them (cached tiles at once, then the view, then rings outward from the hero). `onView` is the map's view callback;
 * `snapAt` answers a tap with the street under it.
 */
export function useLod({ tiles, hero, online, enabled = LOD_ENABLED }: Args) {
  const store = useMemo(() => new LodStore(), [])
  const layer = useMemo(() => new LodLayer(store, lodRadiusFrom(typeof location === 'undefined' ? '' : location.search)), [store])
  const prefetcher = useRef<LodPrefetcher | undefined>(undefined)
  const heroRef = useRef(hero)

  useEffect(() => {
    heroRef.current = hero
    layer.setHero(hero)
    prefetcher.current?.setHero(hero)
  }, [hero, layer])

  useEffect(() => {
    if (!enabled) return
    const p = new LodPrefetcher({ source: tiles, store, radiusM: layer.radius })
    prefetcher.current = p
    p.setHero(heroRef.current)
    const visible = () => {
      if (typeof document !== 'undefined' && !document.hidden) p.retry()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      p.dispose()
      if (prefetcher.current === p) prefetcher.current = undefined
    }
  }, [enabled, tiles, store, layer])

  useEffect(() => {
    if (online) prefetcher.current?.retry()
  }, [online])

  useEffect(() => () => store.dispose(), [store])

  const onView = useCallback((box: BBox, centre: LatLon) => prefetcher.current?.setView(box, centre), [])
  const snapAt = useCallback((p: LatLon, zoom: number, metresPerTile: number): Snap | undefined => layer.snapAt(p, zoom, metresPerTile), [layer])
  return { layer: enabled ? layer : undefined, onView, snapAt }
}
