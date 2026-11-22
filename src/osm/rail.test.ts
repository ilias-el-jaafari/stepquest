import { describe, expect, it } from 'vitest'
import { classifyWay, isArea, isRailTrack, isWalkable } from './classify.ts'
import { DEMO_AREA, overpassQuery } from './demoArea.ts'
import { loadDemoOsm } from './demo.ts'
import { normalizeOverpass } from './normalize.ts'
import { WalkGraph } from '../routing/graph.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { railStamps } from '../render/rails.ts'

describe('tram, metro and train tracks', () => {
  it('draws above-ground tracks as rails and never walks on them', () => {
    for (const railway of ['tram', 'light_rail', 'rail', 'subway', 'narrow_gauge']) {
      expect(classifyWay({ railway })).toBe('rail')
      expect(isWalkable({ railway })).toBe(false)
      expect(isRailTrack({ railway })).toBe(true)
    }
    // Even when someone also tagged a highway on the track.
    expect(classifyWay({ railway: 'tram', highway: 'footway' })).toBe('rail')
    expect(isWalkable({ railway: 'tram', highway: 'footway', foot: 'yes' })).toBe(false)
    // A cutting with tunnel=no is still visible; tunnels are not drawn at all.
    expect(classifyWay({ railway: 'subway', tunnel: 'no', layer: '-1' })).toBe('rail')
    expect(classifyWay({ railway: 'subway', tunnel: 'yes' })).toBeUndefined()
    expect(classifyWay({ railway: 'subway', layer: '-2' })).toBeUndefined()
    expect(classifyWay({ railway: 'platform' })).toBeUndefined()
    expect(isArea('rail', { railway: 'tram' }, true)).toBe(false)
  })

  it('asks Overpass for track ways', () => {
    expect(overpassQuery(DEMO_AREA.bbox)).toMatch(/way\["railway"~"\^\(tram\|light_rail\|rail\|subway\|narrow_gauge\)\$"\]/)
  })

  it('keeps a street crossing the tracks walkable but adds no edge along the rails', () => {
    const data = normalizeOverpass(
      {
        elements: [
          { type: 'way', id: 1, tags: { railway: 'tram' }, nodes: [1, 2, 3], geometry: [{ lat: 39.49, lon: -0.392 }, { lat: 39.49, lon: -0.39 }, { lat: 39.49, lon: -0.388 }] },
          { type: 'way', id: 2, tags: { highway: 'footway', footway: 'crossing', railway: 'crossing' }, nodes: [4, 2, 5], geometry: [{ lat: 39.489, lon: -0.39 }, { lat: 39.49, lon: -0.39 }, { lat: 39.491, lon: -0.39 }] },
        ],
      },
      { south: 39.48, west: -0.4, north: 39.5, east: -0.38 },
    )
    const graph = new WalkGraph(data)
    expect(data.ways.find((w) => w.id === 1)).toMatchObject({ kind: 'rail', walkable: false })
    // Only the crossing's two edges (both directions) exist.
    expect(graph.targets.length).toBe(4)
  })

  it('has the Benicalap tram and metro lines in the demo map, drawn and never routed', () => {
    const data = loadDemoOsm()
    const rails = data.ways.filter((w) => w.kind === 'rail')
    expect(rails.length).toBeGreaterThan(20)
    expect(rails.every((w) => !w.walkable)).toBe(true)
    const railNodes = new Set(rails.flatMap((w) => w.nodes))
    const graph = new WalkGraph(data)
    const used = new Set<number>()
    for (const w of data.ways) if (w.walkable) for (const n of w.nodes) used.add(n)
    expect([...railNodes].some((n) => used.has(n))).toBe(false)
    expect(graph.size).toBeGreaterThan(0)
    expect(buildTileGrid(data).rails.length).toBe(rails.filter((w) => !w.tunnel).length)
  })

  it('stamps rails with sleepers at a steady spacing and the line normal', () => {
    const s = railStamps([{ x: 0, y: 0 }, { x: 0, y: 40 }], 2, 8)
    expect(s).toHaveLength(21)
    expect(s.filter((p) => p.sleeper)).toHaveLength(5)
    expect(s[0]!.nx).toBeCloseTo(-1)
    expect(s[0]!.ny).toBeCloseTo(0)
    expect(railStamps([{ x: 0, y: 0 }], 2, 8)).toEqual([])
  })
})
