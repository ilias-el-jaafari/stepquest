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

export function bboxAround(center: LatLon, radiusM: number): BBox {
  const dLat = radiusM / 111_320
  const dLon = radiusM / (111_320 * Math.cos(center.lat * DEG))
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lon - dLon,
    east: center.lon + dLon,
  }
}

export function bboxContains(box: BBox, p: LatLon): boolean {
  return p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east
}

export function bboxCenter(box: BBox): LatLon {
  return { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 }
}

/**
 * Local equirectangular projection around an origin. Accurate to well under a
 * tile over the few kilometres a walk covers. x grows east, y grows south
 * (screen order), both in metres.
 */
export class LocalProjection {
  readonly origin: LatLon
  private readonly mPerDegLat: number
  private readonly mPerDegLon: number

  constructor(origin: LatLon) {
    this.origin = origin
    this.mPerDegLat = EARTH_RADIUS_M * DEG
    this.mPerDegLon = EARTH_RADIUS_M * DEG * Math.cos(origin.lat * DEG)
  }

  toXY(p: LatLon): { x: number; y: number } {
    return {
      x: (p.lon - this.origin.lon) * this.mPerDegLon,
      y: (this.origin.lat - p.lat) * this.mPerDegLat,
    }
  }

  toLatLon(x: number, y: number): LatLon {
    return {
      lat: this.origin.lat - y / this.mPerDegLat,
      lon: this.origin.lon + x / this.mPerDegLon,
    }
  }
}
