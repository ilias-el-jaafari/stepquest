import { describe, expect, it } from 'vitest'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { SAFETY_LIT, SAFETY_SIDEWALK } from '../osm/types.ts'
import { matchTags } from './enrich.ts'

const M = 1 / 111_195
const at = (north: number, east: number): [number, number] => [39.45 + north * M, -0.35 + (east * M) / Math.cos((39.45 * Math.PI) / 180)]

function ways(specs: { pts: [number, number][]; safety?: number; name?: string }[]): OsmData {
  const lat: number[] = []
  const lon: number[] = []
  const w: OsmWay[] = specs.map((s, k) => ({
    id: k + 1,
    kind: 'road',
    highway: 'residential',
    walkable: true,
    area: false,
    tunnel: false,
    crossing: false,
    ...(s.safety !== undefined ? { safety: s.safety } : {}),
    ...(s.name ? { name: s.name } : {}),
    nodes: s.pts.map(([la, lo]) => (lat.push(la), lon.push(lo), lat.length - 1)),
  }))
  return { bbox: { south: 39.4, west: -0.4, north: 39.5, east: -0.3 }, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways: w, pois: [], source: 'overpass', timestamp: '' }
}

describe('matchTags', () => {
  const overpass = ways([{ pts: [at(0, -300), at(0, 300)], safety: SAFETY_LIT | SAFETY_SIDEWALK, name: 'Carrer de Colón' }])

  it('hands the flags and the name of the street a tile way lies on', () => {
    const base = ways([{ pts: [at(2, -250), at(-2, 0), at(2, 250)] }])
    const out = matchTags(base, [0], overpass)
    expect(out.get(0)).toEqual({ safety: SAFETY_LIT | SAFETY_SIDEWALK, name: 'Carrer de Colón' })
  })

  it('ignores a street farther than 6 m, or one that crosses at an angle', () => {
    const far = ways([{ pts: [at(12, -250), at(12, 250)] }])
    const across = ways([{ pts: [at(-200, 0), at(200, 0)] }])
    expect(matchTags(far, [0], overpass).size).toBe(0)
    expect(matchTags(across, [0], overpass).size).toBe(0)
  })

  it('needs most of the way to agree: a short stretch on a street is not enough', () => {
    const base = ways([{ pts: [at(1, 250), at(1, 330), at(400, 330)] }])
    expect(matchTags(base, [0], overpass).size).toBe(0)
  })

  it('reads a street that runs the other way and leaves untagged Overpass ways out', () => {
    const base = ways([{ pts: [at(0, 250), at(0, -250)] }])
    expect(matchTags(base, [0], overpass).get(0)?.name).toBe('Carrer de Colón')
    const bare = ways([{ pts: [at(0, -300), at(0, 300)] }])
    expect(matchTags(base, [0], bare).size).toBe(0)
  })
})
