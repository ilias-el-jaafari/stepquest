import { distanceToRingM, pointInRing, vertexKey } from './geometry.ts'
import { compareSights } from './classify.ts'
import type { Ground, LinkedSight, Sight, SightKind } from './types.ts'

/**
 * Real areas of sights (landmarks spec, requirement L10): which landuse polygon is a sight's grounds, which
 * building polygon its footprint, and how pieces cut by a tile edge become one area. Pure.
 */

/** How far (m) a sight may lie from the grounds of its kind and still belong to them. */
export const GROUNDS_REACH_M = 60
/** How far (m) from a building polygon a sight's point may lie (a point set a little off its roof). */
export const FOOTPRINT_REACH_M = 25

/** OpenMapTiles `landuse` class -> the sight kind whose grounds it is. */
export function groundKind(landuseClass: string | undefined): SightKind | undefined {
  switch (landuseClass) {
    case 'university':
    case 'college':
      return 'university'
    case 'school':
      return 'school'
    case 'hospital':
      return 'hospital'
    default:
      return undefined
  }
}

/** Sights whose building is their footprint (everything but monuments, which are points). */
export const hasFootprint = (k: SightKind): boolean => !['tower', 'arch', 'statue', 'fountain'].includes(k)

/** Pieces of one polygon: rings that share an end point (rounded to 1e-6°) are one group. Order-independent. */
export function groupPieces(pieces: readonly Ground[]): Ground[][] {
  const parent = pieces.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const owner = new Map<string, number>()
  pieces.forEach((g, i) => {
    for (let k = 0; k < g.ring.length; k += 2) {
      const key = `${g.kind}:${g.mode}:${vertexKey(g.ring[k]!, g.ring[k + 1]!)}`
      const o = owner.get(key)
      if (o === undefined) owner.set(key, i)
      else parent[find(i)] = find(o)
    }
  })
  const groups = new Map<number, Ground[]>()
  pieces.forEach((g, i) => {
    const r = find(i)
    const list = groups.get(r)
    if (list) list.push(g)
    else groups.set(r, [g])
  })
  return [...groups.values()]
}

/** Metres from a point to a group: 0 when inside a piece. */
function groupDistance(lat: number, lon: number, group: readonly Ground[]): number {
  let best = Infinity
  for (const g of group) {
    if (pointInRing(lat, lon, g.ring)) return 0
    best = Math.min(best, distanceToRingM(lat, lon, g.ring))
  }
  return best
}

/** The group of `mode` pieces nearest to the point, within `reach`. */
function nearest(groups: readonly Ground[][], lat: number, lon: number, reach: number): Ground[] | undefined {
  let best: Ground[] | undefined
  let bestD = reach
  for (const g of groups) {
    const d = groupDistance(lat, lon, g)
    if (d < bestD || (best === undefined && d <= reach)) {
      best = g
      bestD = d
    }
  }
  return best
}

const groupKey = (g: readonly Ground[]): string => g.map((p) => `${p.ring[0]},${p.ring[1]},${p.ring.length}`).sort()[0]!

/**
 * Link every sight with its area: grounds (university, school, hospital) first, else the footprint of the
 * building that holds its point. Sights that end up with the same grounds are one place: the most important
 * stays. The result keeps the order of `compareSights`, so it does not depend on the input order.
 */
export function linkSights(sights: readonly Sight[], grounds: readonly Ground[] | undefined): LinkedSight[] {
  if (!grounds?.length) return sights.slice()
  const byKind = new Map<string, Ground[][]>()
  const groupsOf = (kind: SightKind, mode: Ground['mode']): Ground[][] => {
    const key = `${kind}:${mode}`
    let list = byKind.get(key)
    if (!list) {
      list = groupPieces(grounds.filter((g) => g.mode === mode && g.kind === kind))
      byKind.set(key, list)
    }
    return list
  }
  const seen = new Set<string>()
  const out: LinkedSight[] = []
  for (const s of [...sights].sort(compareSights)) {
    if (!hasFootprint(s.kind)) {
      out.push(s)
      continue
    }
    const grd = nearest(groupsOf(s.kind, 'grounds'), s.lat, s.lon, GROUNDS_REACH_M)
    if (grd) {
      const key = `g:${s.kind}:${groupKey(grd)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...s, area: { mode: 'grounds', rings: grd.map((p) => p.ring) } })
      continue
    }
    const fp = nearest(groupsOf(s.kind, 'footprint'), s.lat, s.lon, FOOTPRINT_REACH_M)
    out.push(fp ? { ...s, area: { mode: 'footprint', rings: fp.map((p) => p.ring) } } : s)
  }
  return out
}
