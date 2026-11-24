import type { ReactNode } from 'react'
import { panelId, tabId, type Tab } from './tabs.ts'

/** One tab's panel. Inactive panels stay mounted (their state survives a tab change) but are hidden. */
export function Sheet({ tab, active, className = '', children }: { tab: Tab; active: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={`sheet ${className}`.trim()} id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} hidden={!active}>
      {children}
    </section>
  )
}
