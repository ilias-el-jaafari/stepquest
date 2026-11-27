import type { QuestRoute } from './types.ts'

/**
 * The one count of gems a quest has (quest spec, task 91.3). The flag at the finish is the last gem, so
 * the total is the number of checkpoints. The start line, the HUD counter, Wisp, the voice, the summary
 * and the route-ready line all read it from here and never count on their own.
 */
export function gemTotal(route: Pick<QuestRoute, 'checkpoints'>): number {
  return route.checkpoints.length
}
