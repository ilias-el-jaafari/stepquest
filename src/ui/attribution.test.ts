import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { OSM_ATTRIBUTION } from '../osm/types.ts'

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

describe('OpenStreetMap credit placement', () => {
  const rules = [...stripped.matchAll(/([^{}]*\.map-attribution[^{}]*)\{([^}]*)\}/g)]
  const base = rules[0]?.[2] ?? ''

  it('has one plain bottom-left rule, and no other selector moves it (only its links get their colour)', () => {
    expect(rules.map((r) => r[1]!.trim())).toEqual(['.map-attribution', '.map-attribution a'])
    expect(rules[1]![2]!.trim()).toBe('color: inherit;')
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

  it('says "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" in both languages', () => {
    expect(`${en['map.creditTiles']} ${en['map.creditSchema']} ${en['map.attribution']}`).toBe(OSM_ATTRIBUTION)
    expect(`${es['map.creditTiles']} ${es['map.creditSchema']} ${es['map.attribution']}`).toBe('OpenFreeMap © OpenMapTiles © colaboradores de OpenStreetMap')
  })

  it('fits one line on a 320 px screen in its narrow sans font, in both languages', () => {
    expect(base).toMatch(/font-family:\s*system-ui/)
    const font = Number(base.match(/font-size:\s*(\d+)px/)![1])
    const padding = 2 * Number(base.match(/padding:\s*0 (\d+)px/)![1])
    // A generous average for proportional sans glyphs (Arial and system UI fonts are about 0.5 em).
    const EM_PER_CHAR = 0.6
    for (const t of [en, es]) {
      const text = `${t['map.creditTiles']} ${t['map.creditSchema']} ${t['map.attribution']}`
      expect([...text].length * font * EM_PER_CHAR + padding, text).toBeLessThanOrEqual(320)
    }
  })
})
