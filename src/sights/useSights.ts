import { useMemo } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { sightsAlongRoute, topMonuments } from './route.ts'
import { sightId, type Sight, type SightMark } from './types.ts'

const NONE: readonly SightMark[] = []

/**
 * The two monuments of a quest, fixed the first time any exist for its key, so streaming more map cells
 * never swaps them mid-walk. Without a key the two are recomputed each time (the planner).
 */
export class MonumentLock {
  private key: string | undefined
  private ids: ReadonlySet<string> = new Set()

  choose(sights: readonly Sight[], key?: string): ReadonlySet<string> {
    if (key !== undefined && this.key === key && this.ids.size > 0) return this.ids
    const ids = new Set(topMonuments(sights).map(sightId))
    if (key !== undefined && ids.size > 0) {
      this.key = key
      this.ids = ids
    }
    return ids
  }
}

/** The sights along a route (landmarks spec). Monuments count only when among the two best of the loaded map. */
export function useSights(sights: readonly Sight[] | undefined, route: readonly LatLon[] | undefined, lockKey?: string): readonly SightMark[] {
  const lock = useMemo(() => new MonumentLock(), [])
  return useMemo(() => {
    if (!sights?.length || !route || route.length < 2) return NONE
    const marks = sightsAlongRoute(sights, route, undefined, lock.choose(sights, lockKey))
    return marks.length ? marks : NONE
  }, [sights, route, lockKey, lock])
}
