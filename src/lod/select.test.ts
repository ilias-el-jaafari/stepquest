import { describe, expect, it } from 'vitest'
import { FAR_ZOOM, ZOOM_LEVELS } from '../render/camera.ts'
import { tileBBox } from '../vector/tileMath.ts'
import { clampRadius, DEFAULT_LOD_RADIUS_M, lodRadiusFrom, MAX_LOD_RADIUS_M, MIN_LOD_RADIUS_M, R_FAR_M } from './config.ts'
import { bitmapLevel, distanceToTileM, labelMinZoom, LOD_LEVELS, lodLook, tilesInView, tilesWithin } from './select.ts'
import { Street } from './classes.ts'

const VALENCIA = { lat: 39.4935, lon: -0.392 }
const OSLO = { lat: 60, lon: 10.75 }

describe('look by distance (requirement 25.1)', () => {
  it('uses the tile art above FAR_ZOOM whatever the distance', () => {
    for (const d of [0, 5_000, 9_000, 40_000]) expect(lodLook(d, 2, 9_000)).toBe('art')
  })

  it('at or below FAR_ZOOM: blocks within the radius, coarse beyond, at every ladder level the player can reach', () => {
    for (const z of ZOOM_LEVELS.filter((z) => z <= FAR_ZOOM)) {
      expect(lodLook(0, z, 9_000)).toBe('blocks')
      expect(lodLook(9_000, z, 9_000)).toBe('blocks')
      expect(lodLook(9_001, z, 9_000)).toBe('coarse')
    }
  })

  it('measures from the nearest point of the tile', () => {
    const t = { z: 14, x: 8174, y: 6232 }
    const b = tileBBox(t)
    expect(distanceToTileM(t, { lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2 })).toBe(0)
    const d = distanceToTileM(t, { lat: b.north + 0.01, lon: (b.east + b.west) / 2 })
    expect(d).toBeGreaterThan(1_050)
    expect(d).toBeLessThan(1_150)
  })
})

describe('bitmap levels (requirement 25.4)', () => {
  it('picks the smallest level that is at least as big as the tile on screen, else the biggest', () => {
    expect(LOD_LEVELS).toEqual([256, 384, 512, 768, 1024])
    expect(bitmapLevel(100)).toBe(256)
    expect(bitmapLevel(256)).toBe(256)
    expect(bitmapLevel(257)).toBe(384)
    expect(bitmapLevel(378)).toBe(384)
    expect(bitmapLevel(756)).toBe(768)
    expect(bitmapLevel(1134)).toBe(1024)
    expect(bitmapLevel(5000)).toBe(1024)
  })
})

describe('tiles within the radius, in ring order (requirement 25.8)', () => {
  it('lists nearest first, ties by row then column, all within R, and nothing twice', () => {
    const tiles = tilesWithin(VALENCIA, 9_000)
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1]!
      const b = tiles[i]!
      expect(a.distM <= b.distM).toBe(true)
      if (a.distM === b.distM) expect(a.id.y < b.id.y || (a.id.y === b.id.y && a.id.x < b.id.x)).toBe(true)
    }
    expect(tiles.every((t) => t.distM <= 9_000)).toBe(true)
    expect(new Set(tiles.map((t) => `${t.id.x}/${t.id.y}`)).size).toBe(tiles.length)
    expect(tiles[0]!.distM).toBe(0)
  })

  it('counts about 100 z14 tiles at València and about 190 at 60° north for R = 9 km (the honest number for the spec)', () => {
    const v = tilesWithin(VALENCIA, 9_000).length
    const o = tilesWithin(OSLO, 9_000).length
    expect(v).toBeGreaterThan(85)
    expect(v).toBeLessThan(130)
    expect(o).toBeGreaterThan(160)
    expect(o).toBeLessThan(230)
  })

  it('grows with the radius and is empty-free at the minimum', () => {
    expect(tilesWithin(VALENCIA, MIN_LOD_RADIUS_M).length).toBeGreaterThanOrEqual(4)
    expect(tilesWithin(VALENCIA, 12_000).length).toBeGreaterThan(tilesWithin(VALENCIA, 9_000).length)
  })

  it('the view tiles come nearest the view centre first', () => {
    const box = { south: 39.48, north: 39.51, west: -0.41, east: -0.37 }
    const centre = { lat: 39.495, lon: -0.39 }
    const t = tilesInView(box, centre)
    expect(t.length).toBeGreaterThan(1)
    expect(t[0]!.distM).toBe(0)
    for (let i = 1; i < t.length; i++) expect(t[i - 1]!.distM <= t[i]!.distM).toBe(true)
  })
})

describe('label zoom by class (requirement 25.6)', () => {
  it('big streets from 0.5, tertiary from 0.75, everything named from FAR_ZOOM', () => {
    expect(labelMinZoom(Street.primary)).toBe(0.5)
    expect(labelMinZoom(Street.secondary)).toBe(0.5)
    expect(labelMinZoom(Street.tertiary)).toBe(0.75)
    expect(labelMinZoom(Street.minor)).toBe(FAR_ZOOM)
    expect(labelMinZoom(Street.service)).toBe(FAR_ZOOM)
  })
})

describe('the radius setting', () => {
  it('defaults to 10 km (the far-pick distance), reads ?lod=<km> and clamps', () => {
    expect(DEFAULT_LOD_RADIUS_M).toBe(10_000)
    expect(lodRadiusFrom('')).toBe(10_000)
    expect(lodRadiusFrom(undefined)).toBe(10_000)
    expect(DEFAULT_LOD_RADIUS_M).toBeGreaterThanOrEqual(R_FAR_M)
    expect(lodRadiusFrom('?lod=12')).toBe(12_000)
    expect(lodRadiusFrom('?lod=100')).toBe(MAX_LOD_RADIUS_M)
    expect(lodRadiusFrom('?lod=0.1')).toBe(MIN_LOD_RADIUS_M)
    expect(lodRadiusFrom('?lod=abc')).toBe(10_000)
    expect(clampRadius(Number.NaN)).toBe(10_000)
  })
})
