import { haversine, type LatLon } from '../geo/geo.ts'
import { FOCUS_RADIUS_M, MAX_VIEW_FOCUS } from './config.ts'

/**
 * Places away from the hero that get the full detail too (map-rendering requirement 26.3): the finish the player tapped, and the
 * last places the view rested at beyond the reach of the hero's rings. Pure: the app feeds it, the layer and the prefetcher read it.
 */
export class LodFocus {
  private finish: LatLon | undefined
  private views: LatLon[] = []

  /** Set or clear the tapped finish. Returns whether the list changed. */
  pin(p: LatLon | undefined): boolean {
    const same = p === this.finish || (!!p && !!this.finish && p.lat === this.finish.lat && p.lon === this.finish.lon)
    this.finish = p
    return !same
  }

  /**
   * The view rested at `centre`. It becomes a focus when the hero's rings (radius `heroRadiusM`) do not reach it and no focus is
   * within half the focus radius of it already; only the newest `MAX_VIEW_FOCUS` are kept. Returns whether the list changed.
   */
  view(centre: LatLon, hero: LatLon | undefined, heroRadiusM: number): boolean {
    if (hero && haversine(hero, centre) <= heroRadiusM - FOCUS_RADIUS_M / 2) return false
    if (this.points().some((p) => haversine(p, centre) < FOCUS_RADIUS_M / 2)) return false
    this.views = [centre, ...this.views].slice(0, MAX_VIEW_FOCUS)
    return true
  }

  /** The finish first, then the views, newest first. */
  points(): LatLon[] {
    return this.finish ? [this.finish, ...this.views] : [...this.views]
  }
}
