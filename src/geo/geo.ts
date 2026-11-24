export type LatLon = { lat: number; lon: number }
export type BBox = { south: number; west: number; north: number; east: number }

export const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Point reached by travelling `distance` metres from `from` on `bearingDeg` (0 = north). */
export function destination(from: LatLon, bearingDeg: number, distance: number): LatLon {
  const d = distance / EARTH_RADIUS_M
  const b = bearingDeg * DEG
  const lat1 = from.lat * DEG
  const lon1 = from.lon * DEG
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lon2 =
    lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 / DEG, lon: lon2 / DEG }
}

/** The east-west scale is computed at most this far from the equator, so cos(lat) never reaches 0 at a pole. */
export const MAX_LAT = 85

/** Wrap a longitude difference to (-180, 180] so points either side of the antimeridian stay close; differences already inside are returned bit for bit. */
export function wrapDeltaLon(d: number): number {
  if (d > 180 || d <= -180) {
    const w = ((((d + 180) % 360) + 360) % 360) - 180
    return w === -180 ? 180 : w
  }
  return d
}

/** Wrap a longitude into [-180, 180]; a value already inside is returned bit for bit. */
export function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon
  const w = ((((lon + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

/**
 * Square-ish box of half-side `radiusM` around a point, clipped to the valid
 * range (latitude ±90, longitude ±180). A walk next to the antimeridian or a
 * pole gets a trimmed box instead of an invalid one (Overpass rejects
 * longitudes outside ±180); the grid and graph are built per box, so a box
 * never wraps.
 */
export function bboxAround(center: LatLon, radiusM: number): BBox {
  const dLat = radiusM / 111_320
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, center.lat))
  const dLon = radiusM / (111_320 * Math.cos(lat * DEG))
  return {
    south: Math.max(-90, center.lat - dLat),
    north: Math.min(90, center.lat + dLat),
    west: Math.max(-180, center.lon - dLon),
    east: Math.min(180, center.lon + dLon),
  }
}

/** Finite, ordered and inside the valid coordinate range. */
export function isValidBBox(b: BBox): boolean {
  return (
    [b.south, b.west, b.north, b.east].every(Number.isFinite) &&
    b.south >= -90 && b.north <= 90 && b.west >= -180 && b.east <= 180 &&
    b.south < b.north && b.west < b.east
  )
}

/** Exact area of a lat/lon box on the sphere in km² (the width shrinks towards the pole). */
export function bboxAreaSphereKm2(b: BBox): number {
  const r = EARTH_RADIUS_M / 1000
  return r * r * (b.east - b.west) * DEG * (Math.sin(b.north * DEG) - Math.sin(b.south * DEG))
}

export function bboxContains(box: BBox, p: LatLon): boolean {
  return p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east
}

export function bboxCenter(box: BBox): LatLon {
  return { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 }
}

/**
 * Local equirectangular projection around an origin. Accurate to well under a
 * tile over the few kilometres a walk covers (see geo.test.ts for the error at
 * several latitudes). x grows east, y grows south (screen order), both in
 * metres. Longitude differences wrap at the antimeridian, and the east-west
 * scale stops shrinking at ±{@link MAX_LAT}° so the inverse never divides by zero.
 */
export class LocalProjection {
  readonly origin: LatLon
  private readonly mPerDegLat: number
  private readonly mPerDegLon: number

  constructor(origin: LatLon) {
    this.origin = origin
    this.mPerDegLat = EARTH_RADIUS_M * DEG
    this.mPerDegLon = EARTH_RADIUS_M * DEG * Math.cos(Math.max(-MAX_LAT, Math.min(MAX_LAT, origin.lat)) * DEG)
  }

  toXY(p: LatLon): { x: number; y: number } {
    return {
      x: wrapDeltaLon(p.lon - this.origin.lon) * this.mPerDegLon,
      y: (this.origin.lat - p.lat) * this.mPerDegLat,
    }
  }

  toLatLon(x: number, y: number): LatLon {
    return {
      lat: this.origin.lat - y / this.mPerDegLat,
      lon: wrapLon(this.origin.lon + x / this.mPerDegLon),
    }
  }
}
