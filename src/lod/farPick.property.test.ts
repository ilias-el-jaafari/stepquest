import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { destination, haversine, type LatLon } from '../geo/geo.ts'
import { FAR_ZOOM } from '../render/camera.ts'
import { R_FAR_M } from './config.ts'
import { LodLayer } from './layer.ts'
import { snapRadiusM } from './snap.ts'
import { tilesWithin } from './select.ts'
import { LodStore } from './store.ts'
import { makeLod } from './testing.ts'

/** Every tap within 10 km of the hero snaps to a street when the tiles are there (map-rendering requirement 26.4). */
const HERO: LatLon = { lat: 39.4697, lon: -0.3774 }
const M_PER_TILE = 5

/** A street every 400 tile units (about 185 m) both ways, so no point of a tile is farther than 93 m from one. */
const streets = (() => {
  const lines: { cls: string; pts: [number, number][] }[] = []
  for (let u = 200; u < 4096; u += 400) {
    lines.push({ cls: 'minor', pts: [[0, u], [4096, u]] })
    lines.push({ cls: 'minor', pts: [[u, 0], [u, 4096]] })
  }
  return lines
})()

const layer = (() => {
  const store = new LodStore({ canvas: () => undefined, later: () => undefined })
  const l = new LodLayer(store, R_FAR_M)
  l.setHero(HERO)
  for (const t of tilesWithin(HERO, R_FAR_M)) store.put(makeLod(t.id, { lines: streets }))
  return l
})()

describe('far pick: any tap within 10 km snaps (requirement 26.4)', () => {
  it('the reach of a tap at the far zooms is at least the 93 m the street grid needs', () => {
    expect(snapRadiusM(FAR_ZOOM, M_PER_TILE)).toBeGreaterThan(90)
  })

  it('a tap anywhere within R_FAR of the hero, at any far zoom, gives a snapped point near it', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0.5, 0.75, 1, FAR_ZOOM), (bearing, f, zoom) => {
        const tap = destination(HERO, bearing, Math.sqrt(f) * R_FAR_M)
        expect(haversine(tap, HERO)).toBeLessThanOrEqual(R_FAR_M + 1)
        const hit = layer.snapAt(tap, zoom, M_PER_TILE)
        expect(hit).toBeDefined()
        expect(haversine(hit!.point, tap)).toBeLessThanOrEqual(snapRadiusM(zoom, M_PER_TILE) + 1)
      }),
      { numRuns: 300, seed: 26 },
    )
  })

  it('a tap where no tile is loaded keeps the tapped point (no snap)', () => {
    expect(layer.snapAt(destination(HERO, 90, R_FAR_M + 6_000), FAR_ZOOM, M_PER_TILE)).toBeUndefined()
  })
})
