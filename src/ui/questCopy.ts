import type { Translate } from '../i18n/index.ts'
import { gemTotal } from '../quest/gems.ts'
import type { QuestRoute } from '../quest/types.ts'

/** The lines of the start bubble. The number is the quest's gem total, the same the HUD, voice and summary use. */
export function startLines(route: Pick<QuestRoute, 'checkpoints'>, t: Translate): string[] {
  const total = gemTotal(route)
  return total > 1 ? [t('dlg.start1', { n: total }), t('dlg.start2')] : [t('dlg.startFlag')]
}
