import type { PlainKey } from '../i18n/en.ts'
import type { Phase } from '../render/daylight.ts'
import type { GhostPose } from './art.ts'

/** One thing the ghost says: a dictionary key (no placeholders), how it poses and how long the bubble stays. */
export type GhostLine = { key: PlainKey; pose: GhostPose; ms: number }

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

/** The friendly scare after dusk: a quick "Boo!" pop, then the lit way. Never a sound; reduced motion only drops the pop. */
export const NIGHT_LINES: readonly GhostLine[] = [
  { key: 'ghost.boo', pose: 'boo', ms: 1500 },
  { key: 'ghost.lit', pose: 'float', ms: 4200 },
]

/** The scare happens once per quest, the first time the light is dusk or night. */
export function shouldScare(phase: Phase, alreadyScared: boolean): boolean {
  return !alreadyScared && (phase === 'dusk' || phase === 'night')
}
