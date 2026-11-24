import { describe, expect, it } from 'vitest'
import { APP_NAME } from './config/brand.ts'
import manifestText from '../public/manifest.webmanifest?raw'
import html from '../index.html?raw'

// Files shipped from public/ (paths relative to it).
const publicFiles = new Set(Object.keys(import.meta.glob('../public/**/*', { query: '?url', eager: true })).map((p) => p.replace('../public/', '')))
const exists = (p: string) => publicFiles.has(p)

describe('home-screen app setup', () => {
  it('has a standalone web app manifest with real icon files', () => {
    const m = JSON.parse(manifestText) as { name: string; short_name: string; display: string; start_url: string; scope: string; icons: { src: string; sizes: string; purpose: string }[] }
    expect(m.name).toBe(APP_NAME)
    expect(m.short_name).toBe(APP_NAME)
    expect(m.display).toBe('standalone')
    // Relative, so it works under the GitHub Pages sub-path.
    expect(m.start_url).toBe('./')
    expect(m.scope).toBe('./')
    expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true)
    expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true)
    for (const icon of m.icons) expect(exists(icon.src), icon.src).toBe(true)
  })
  it('does not lock the screen to portrait (landscape must work for people who dock the phone)', () => {
    expect((JSON.parse(manifestText) as { orientation: string }).orientation).toBe('any')
  })
  it('sets the iPhone meta tags and safe-area viewport', () => {
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('apple-mobile-web-app-status-bar-style')
    expect(exists('icons/apple-touch-icon.png')).toBe(true)
  })
})
