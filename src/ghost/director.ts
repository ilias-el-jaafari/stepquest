import type { SightMark } from '../sights/types.ts'
import type { PlainKey } from '../i18n/en.ts'
import type { Phase } from '../render/daylight.ts'
import type { GhostPose } from './art.ts'

/** One thing the ghost says: a dictionary key (no placeholders), how it poses and how long the bubble stays. */
export type SightNamedKey = 'ghost.sightNamed.university' | 'ghost.sightNamed.school' | 'ghost.sightNamed.hospital' | 'ghost.sightNamed.monument'
export type GhostLine = { key: PlainKey | SightNamedKey; pose: GhostPose; ms: number; /** The place's name, for the `{name}` of a sight line. */ name?: string }

const CHECKPOINT_KEYS = ['ghost.cp.1', 'ghost.cp.2', 'ghost.cp.3', 'ghost.cp.4', 'ghost.cp.5'] as const

/** The comment for gem `index` of `total` (the finish counts as the last one). Varies by quest seed, never repeats back to back. */
export function checkpointLine(index: number, total: number, seed: number): GhostLine {
  if (index >= total) return finishLine()
  if (index === total - 1) return { key: 'ghost.cpLast', pose: 'float', ms: 3600 }
  const i = (Math.abs(Math.trunc(seed)) + index) % CHECKPOINT_KEYS.length
  return { key: CHECKPOINT_KEYS[i]!, pose: 'float', ms: 3400 }
}

export function finishLine(): GhostLine {
  return { key: 'ghost.finish', pose: 'happy', ms: 6000 }
}

/** The friendly scare after dusk: a quick "Boo!" pop, then the lit way. A soft jingle goes with it (`scare` in `audio/sfx.ts`, on the effects channel); reduced motion only drops the pop. */
export const NIGHT_LINES: readonly GhostLine[] = [
  { key: 'ghost.boo', pose: 'boo', ms: 1500 },
  { key: 'ghost.lit', pose: 'float', ms: 4200 },
]

/** The scare happens once per quest, the first time the light is dusk or night. */
export function shouldScare(phase: Phase, alreadyScared: boolean): boolean {
  return !alreadyScared && (phase === 'dusk' || phase === 'night')
}

/** Sight kinds whose line names the place when the data has a name. */
const NAMED_SIGHT: Record<string, 'university' | 'school' | 'hospital' | 'monument'> = {
  university: 'university',
  school: 'school',
  hospital: 'hospital',
  tower: 'monument',
  arch: 'monument',
  statue: 'monument',
  fountain: 'monument',
}
/** A name is cut to this many characters so the bubble stays short. */
export const SIGHT_NAME_MAX = 22

/** What Wisp says about a sight the hero passes: a keyed line, with the name when there is one to say. */
export function sightLine(mark: Pick<SightMark, 'kind' | 'name'>): GhostLine {
  const named = NAMED_SIGHT[mark.kind]
  if (named && mark.name) {
    const name = mark.name.length > SIGHT_NAME_MAX ? `${mark.name.slice(0, SIGHT_NAME_MAX - 1).trimEnd()}…` : mark.name
    return { key: `ghost.sightNamed.${named}`, pose: 'float', ms: 4200, name }
  }
  return { key: `ghost.sight.${mark.kind}`, pose: 'float', ms: 3800 }
}

/** At least this long between two lines about sights, so a street of schools is not chatter. */
export const SIGHT_GAP_MS = 20_000
