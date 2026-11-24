import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { msToMidnight } from '../app/useToday.ts'

// Checks on the style sheet that a browser would otherwise have to show (safe areas, landscape, dead rules).

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true })
const words = new Set(Object.values(sources).flatMap((code) => code.match(/[A-Za-z][\w-]*/g) ?? []))
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('style sheet', () => {
  it('has no class that no code uses', () => {
    const classes = new Set([...stripped.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!))
    // Classes that React sets from an expression (`tab-${tab}`, `chev up`) are listed by their words in code.
    expect([...classes].filter((c) => !words.has(c))).toEqual([])
  })

  it('declares each property of a selector once per level (no rule fully overridden by a later copy)', () => {
    const rules: { sel: string; props: string[] }[] = []
    let depth = 0
    let head = 0
    let selector = ''
    let bodyStart = 0
    for (let i = 0; i < stripped.length; i++) {
      const c = stripped[i]
      if (c === '{') {
        if (depth === 0) {
          selector = stripped.slice(head, i).trim().replace(/\s+/g, ' ')
          bodyStart = i + 1
        }
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0) {
          // At-rules (@media, @keyframes) hold their own rules; only plain top-level rules are compared.
          if (!selector.startsWith('@')) rules.push({ sel: selector, props: [...stripped.slice(bodyStart, i).matchAll(/([\w-]+)\s*:/g)].map((p) => p[1]!) })
          head = i + 1
        }
      }
    }
    const seen = new Map<string, Set<string>>()
    const dead: string[] = []
    for (const r of rules) {
      const before = seen.get(r.sel)
      if (before) for (const p of r.props) if (before.has(p)) dead.push(`${r.sel} { ${p} }`)
      seen.set(r.sel, new Set([...(before ?? []), ...r.props]))
    }
    // A property repeated in a later rule is allowed only when it is deliberate (none today).
    expect(dead.slice(0, 5)).toEqual([])
  })

  it('keeps the phone frame inside the notch and the home bar', () => {
    for (const edge of ['top', 'bottom', 'left', 'right']) expect(stripped).toContain(`env(safe-area-inset-${edge}`)
    expect(stripped).toMatch(/\.tabbar \{[^}]*padding-bottom: env\(safe-area-inset-bottom\)/)
    expect(stripped).toMatch(/\.topbar \{[^}]*padding-top: max\([^)]*env\(safe-area-inset-top\)/)
    expect(stripped).toMatch(/\.net-banner \{[^}]*env\(safe-area-inset-left\)/)
    expect(stripped).toMatch(/\.crash \{[^}]*env\(safe-area-inset-bottom\)/)
  })

  it('has a layout for a phone on its side and a narrow header', () => {
    expect(stripped).toMatch(/@media \(orientation: landscape\) and \(max-height: 520px\)[^{]*\{[\s\S]*?\.layout \{[^}]*flex-direction: row/)
    expect(stripped).toMatch(/@media \(max-width: 359px\)/)
    expect(stripped).toMatch(/@media \(max-width: 430px\)[^{]*\{[\s\S]*?\.logo \{[^}]*font-size: 13px/)
  })

  it('uses dynamic viewport height so the browser bar does not hide the tab bar', () => {
    expect(stripped).toContain('100dvh')
  })
})

describe('midnight timer', () => {
  it('counts to just after the next local midnight', () => {
    const noon = new Date(2026, 10, 15, 12, 0, 0).getTime()
    expect(msToMidnight(noon)).toBe(12 * 3_600_000 + 1000)
    const late = new Date(2026, 10, 15, 23, 59, 59).getTime()
    expect(msToMidnight(late)).toBe(2000)
  })
})
