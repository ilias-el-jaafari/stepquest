/** The app's four tabs, in tab-bar order. */
export const TABS = ['map', 'bag', 'hero', 'settings'] as const
export type Tab = (typeof TABS)[number]

export const tabId = (tab: Tab) => `tab-${tab}`
export const panelId = (tab: Tab) => `tabpanel-${tab}`
