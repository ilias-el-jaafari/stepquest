import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

describe('OpenStreetMap credit placement', () => {
  const rules = [...stripped.matchAll(/([^{}]*\.map-attribution[^{}]*)\{([^}]*)\}/g)]
  const base = rules[0]?.[2] ?? ''

  it('has exactly one rule, a plain bottom-left one, that no other selector moves', () => {
    expect(rules).toHaveLength(1)
    expect(rules[0]![1]!.trim()).toBe('.map-attribution')
    expect(base).toMatch(/position:\s*absolute/)
    expect(base).toMatch(/left:\s*0;/)
    expect(base).toMatch(/bottom:\s*0;/)
    expect(base).not.toMatch(/\b(top|right):/)
  })

  it('sits above the canvas and has a fixed height', () => {
    expect(base).toMatch(/z-index:\s*([4-9]|\d\d)/)
    expect(base).toMatch(/height:\s*var\(--attr-h\)/)
  })

  it('is at least 7 px, dark on a nearly opaque paper backing (contrast above 4.5)', () => {
    expect(Number(base.match(/font-size:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(7)
    const fg = base.match(/color:\s*(#[0-9a-f]{6})/)![1]!
    const bg = base.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!
    expect(Number(bg[4])).toBeGreaterThanOrEqual(0.85)
    const hex = '#' + [bg[1], bg[2], bg[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
    const [a, b] = [lum(fg), lum(hex)].sort((x, y) => y - x)
    expect((a! + 0.05) / (b! + 0.05)).toBeGreaterThan(4.5)
  })

  it('keeps the quest bottom HUD and the map banners above the credit strip', () => {
    expect(css).toMatch(/--attr-h:\s*16px/)
    expect(stripped).toMatch(/\.hud-bottom \{\s*bottom:[^;]*var\(--attr-h\)/)
    expect(stripped).toMatch(/\.console-screen \.hud-bottom \{\s*bottom:[^;]*var\(--attr-h\)/)
    expect(stripped).toMatch(/\.map-banner \{[^}]*bottom:[^;]*var\(--attr-h\)/)
    expect(stripped).toMatch(/\.area-toast \{\s*bottom:[^;]*var\(--attr-h\)/)
  })

  it('says "© OpenStreetMap contributors" in both languages', () => {
    expect(en['map.attribution']).toBe('© OpenStreetMap contributors')
    expect(es['map.attribution']).toContain('© colaboradores de OpenStreetMap')
  })
})
