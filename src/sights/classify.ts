import type { Tags } from '../osm/classify.ts'
import { haversine } from '../geo/geo.ts'
import { MERGE_M, isMonumentKind, type MonumentClass, type Sight, type SightKind } from './types.ts'

const RELIGION_KIND: Record<string, SightKind> = { christian: 'church', muslim: 'mosque', jewish: 'synagogue' }

/** Church, mosque, synagogue; every other religion, and a place with none given, is a generic temple. */
export function worshipKind(religion: string | undefined): SightKind {
  return RELIGION_KIND[(religion ?? '').toLowerCase()] ?? 'temple'
}

const FOUNTAIN = /fuente|font\b|fountain|surtidor|brunnen/i
const ARCH = /\barc\b|\barco\b|\barch\b|\bporta\b|\bpuerta|\bportal\b|\bgate\b|\bpuente\b/i
const TOWER = /\btorre|\btower|\btorr[ée]s\b|campanar|miguelete|\bfaro\b|lighthouse|castell|castillo|castle|muralla|\bmurall|\bpalau\b|\bpalacio\b/i
const STATUE = /estatua|estàtua|statue|monumento|monument|memorial|busto|escultura|sculpture|homenaje|homenatge|\ba (la|los|las|el)\b/i

function hashOf(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** The generic design for a monument: its class and the words of its name, else a stable pick from the name. */
export function monumentStyle(cls: MonumentClass, name: string): SightKind {
  if (FOUNTAIN.test(name)) return 'fountain'
  if (ARCH.test(name)) return 'arch'
  if (TOWER.test(name)) return 'tower'
  if (STATUE.test(name)) return 'statue'
  if (cls === 'castle') return 'tower'
  if (cls === 'monument' || cls === 'memorial') return 'statue'
  const all: SightKind[] = ['tower', 'arch', 'statue', 'fountain']
  return all[hashOf(name) % all.length]!
}

const CLASS_WEIGHT: Record<MonumentClass, number> = { castle: 30, attraction: 25, monument: 20, memorial: 15, ruins: 12 }
const UNKNOWN_RANK = 200

/** How representative a sight is. Monuments add their class, links to Wikidata and Wikipedia; every sight gets a name and a rank bonus. */
export function sightScore(s: Sight): number {
  const rank = s.rank ?? UNKNOWN_RANK
  return (s.monument ? CLASS_WEIGHT[s.monument] : 0) + (s.name ? 20 : 0) + (s.wikidata ? 25 : 0) + (s.wikipedia ? 25 : 0) + Math.max(0, 40 - rank / 5)
}

/** A total order: higher score first, then name, latitude, longitude. */
export function compareSights(a: Sight, b: Sight): number {
  return sightScore(b) - sightScore(a) || (a.name ?? '').localeCompare(b.name ?? '', 'en') || a.lat - b.lat || a.lon - b.lon || a.kind.localeCompare(b.kind)
}

/** `monument` class of an OpenMapTiles poi or an OSM tag set, when it is a monument candidate. */
function monumentClassOf(cls: string | undefined): MonumentClass | undefined {
  switch (cls) {
    case 'attraction':
    case 'monument':
    case 'memorial':
    case 'castle':
    case 'ruins':
      return cls
    default:
      return undefined
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined)

function build(kind: SightKind, lat: number, lon: number, extra: { name?: string; rank?: number; monument?: MonumentClass; wikidata?: boolean; wikipedia?: boolean }): Sight {
  const s: Sight = { kind, lat, lon }
  if (extra.name) s.name = extra.name
  if (extra.rank !== undefined && Number.isFinite(extra.rank)) s.rank = extra.rank
  if (extra.monument) s.monument = extra.monument
  if (extra.wikidata) s.wikidata = true
  if (extra.wikipedia) s.wikipedia = true
  return s
}

/** One OpenMapTiles `poi` feature (`class`, `subclass`, `name`, `rank`) as a sight, or undefined. */
export function sightFromPoi(p: Record<string, unknown>, lat: number, lon: number): Sight | undefined {
  const cls = str(p.class)
  const sub = str(p.subclass)
  const name = str(p.name) ?? str(p['name:latin']) ?? str(p.name_en)
  const rank = typeof p.rank === 'number' ? p.rank : undefined
  if ((cls === 'college' && (sub === 'university' || sub === 'college')) || (cls === 'university' && sub === 'university')) return build('university', lat, lon, { name, rank })
  if (cls === 'school' && sub === 'school') return build('school', lat, lon, { name, rank })
  if (cls === 'hospital' && sub === 'hospital') return build('hospital', lat, lon, { name, rank })
  if (cls === 'place_of_worship') return build(worshipKind(sub), lat, lon, { name, rank })
  if (cls === 'town_hall' && sub === 'townhall') return build('townHall', lat, lon, { name, rank })
  const mc = monumentClassOf(cls)
  if (mc && name) return build(monumentStyle(mc, name), lat, lon, { name, rank, monument: mc })
  return undefined
}

/** OSM tags (amenity, religion, tourism, historic, wikidata, wikipedia) as a sight, or undefined. */
export function sightFromTags(tags: Tags, lat: number, lon: number): Sight | undefined {
  const name = str(tags.name)
  const flags = { wikidata: !!tags.wikidata, wikipedia: !!tags.wikipedia }
  switch (tags.amenity) {
    case 'university':
    case 'college':
      return build('university', lat, lon, { name, ...flags })
    case 'school':
      return build('school', lat, lon, { name, ...flags })
    case 'hospital':
      return build('hospital', lat, lon, { name, ...flags })
    case 'place_of_worship':
      return build(worshipKind(tags.religion), lat, lon, { name, ...flags })
    case 'townhall':
      return build('townHall', lat, lon, { name, ...flags })
  }
  if (tags.building === 'cathedral' || tags.building === 'church' || tags.building === 'chapel') return build('church', lat, lon, { name, ...flags })
  if (tags.building === 'mosque') return build('mosque', lat, lon, { name, ...flags })
  if (tags.building === 'synagogue') return build('synagogue', lat, lon, { name, ...flags })
  const mc = tags.tourism === 'attraction' ? 'attraction' : tags.historic === 'cathedral' ? undefined : monumentClassOf(tags.historic)
  if (mc && name) return build(monumentStyle(mc, name), lat, lon, { name, monument: mc, ...flags })
  return undefined
}

/**
 * Drop near-duplicates (a campus, a hospital's wings): of the sights of one kind within `MERGE_M` of each
 * other the most important stays. The result does not depend on the order of the input.
 */
export function dedupeSights(sights: readonly Sight[]): Sight[] {
  const out: Sight[] = []
  for (const s of [...sights].sort(compareSights)) {
    if (out.some((q) => q.kind === s.kind && haversine(q, s) < MERGE_M)) continue
    out.push(s)
  }
  return out
}

export { isMonumentKind }
