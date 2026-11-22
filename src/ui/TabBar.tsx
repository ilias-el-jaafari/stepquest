import type { KeyboardEvent } from 'react'
import { useI18n } from '../i18n/index.ts'
import type { MessageKey } from '../i18n/en.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { panelId, tabId, TABS, type Tab } from './tabs.ts'


const LABELS: Record<Tab, MessageKey> = { map: 'tab.map', bag: 'tab.bag', hero: 'tab.hero', settings: 'tab.settings' }


/**
 * Bottom tab bar on phones, a side rail on wide screens (CSS decides). Arrow
 * keys move between tabs, as in a native tab bar.
 */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const { t } = useI18n()
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? TABS[(i + TABS.length - 1) % TABS.length] : undefined
    if (!next) return
    e.preventDefault()
    onTab(next)
    document.getElementById(tabId(next))?.focus()
  }
  return (
    <nav className="tabbar" aria-label={t('tab.nav')}>
      <div role="tablist" aria-orientation="horizontal" className="tabbar-list" onKeyDown={onKey}>
        {TABS.map((name) => (
          <button
            key={name}
            id={tabId(name)}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={panelId(name)}
            tabIndex={tab === name ? 0 : -1}
            className={`tab ${tab === name ? 'on' : ''}`}
            data-testid={`tab-${name}`}
            onClick={() => onTab(name)}
          >
            <span className="tab-icon">
              <PixelIcon name={name} size={24} />
            </span>
            <span className="tab-label">{t(LABELS[name])}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
