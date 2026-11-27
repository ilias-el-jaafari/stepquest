import type { ReactNode } from 'react'
import { panelId, tabId, type Tab } from './tabs.ts'

/**
 * One tab's panel. Inactive panels stay mounted (their state survives a tab change) but are hidden.
 * With `keepSpace` a hidden panel still takes its room on phones (invisible, not focusable), so the map
 * above it keeps its size when another tab covers it: no canvas resize, no rebuild, no stretched bitmap.
 */
export function Sheet({ tab, active, className = '', keepSpace = false, children }: { tab: Tab; active: boolean; className?: string; keepSpace?: boolean; children: ReactNode }) {
  return (
    <section className={`sheet ${keepSpace ? 'keep-space' : ''} ${className}`.replace(/\s+/g, ' ').trim()} id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} hidden={!active}>
      {children}
    </section>
  )
}
