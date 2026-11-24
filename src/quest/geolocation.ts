import { isFreshFix } from './fixFreshness.ts'
import type { GpsFix } from './types.ts'

export type LocationErrorCode = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout' | 'inaccurate'

export type LocationSource = {
  /** Start delivering fixes; returns a stop function. */
  start(onFix: (fix: GpsFix) => void, onError: (code: LocationErrorCode) => void): () => void
}

/** Above this the one-shot "use my location" result is refused. */
export const MAX_START_ACCURACY_M = 300
/** Above this it is accepted with a "weak signal" warning. */
export const WEAK_START_ACCURACY_M = 60

export function mapGeoError(error: { code: number } | undefined): LocationErrorCode {
  switch (error?.code) {
    case 1:
      return 'denied'
    case 3:
      return 'timeout'
    default:
      return 'unavailable'
  }
}

type GeoEnv = { geolocation?: Geolocation; secure: boolean }

function env(): GeoEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    geolocation: nav && 'geolocation' in nav ? nav.geolocation : undefined,
    secure: typeof isSecureContext === 'undefined' ? true : isSecureContext,
  }
}

export function toFix(pos: GeolocationPosition): GpsFix {
  return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp || Date.now() }
}

export type LocateResult = { ok: true; fix: GpsFix; weak: boolean } | { ok: false; code: LocationErrorCode; fix?: GpsFix }

/** One-shot position for "Use my location". */
export function locateOnce(e: GeoEnv = env(), timeoutMs = 15_000): Promise<LocateResult> {
  if (!e.secure) return Promise.resolve({ ok: false, code: 'insecure' })
  if (!e.geolocation) return Promise.resolve({ ok: false, code: 'unsupported' })
  const geo = e.geolocation
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => resolve(judgeStartFix(toFix(pos))),
      (err) => resolve({ ok: false, code: mapGeoError(err) }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}

export function judgeStartFix(fix: GpsFix): LocateResult {
  if (!(fix.accuracy <= MAX_START_ACCURACY_M)) return { ok: false, code: 'inaccurate', fix }
  return { ok: true, fix, weak: fix.accuracy > WEAK_START_ACCURACY_M }
}

/** Continuous high-accuracy tracking through the browser. Cached or future-dated fixes are dropped (`isFreshFix`). */
export function browserSource(e: GeoEnv = env(), now: () => number = Date.now): LocationSource {
  return {
    start(onFix, onError) {
      if (!e.secure) {
        onError('insecure')
        return () => {}
      }
      if (!e.geolocation) {
        onError('unsupported')
        return () => {}
      }
      const geo = e.geolocation
      const id = geo.watchPosition(
        (pos) => {
          const fix = toFix(pos)
          if (isFreshFix(fix, now())) onFix(fix)
        },
        (err) => onError(mapGeoError(err)),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 2_000 },
      )
      return () => geo.clearWatch(id)
    },
  }
}
