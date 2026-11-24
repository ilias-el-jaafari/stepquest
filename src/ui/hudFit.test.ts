import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { en, type PlainKey } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'

/**
 * Fit check for the quest bottom bar and the other button rows on phones from 320 to 430 px.
 * Press Start 2P is square, so a text of `n` characters is `n × font-size` px wide.
 * Geometry from `src/index.css`: console padding 6 + bezel margin 3 + bezel padding 8 + screen inset 10
 * on each side, then the HUD border 4 and the folded bar's padding 10.
 */
const WIDTHS = [320, 360, 375, 390, 414, 430]
const HUD_SIDES = 2 * (6 + 3 + 8 + 10 + 4 + 10)
const BUTTON_GAP = 10
const HIT = 48
const BUTTON_PAD = 16 + 8 // .hud-buttons text button padding (8 + 8) and its raised edge
const MIN_FONT = 9
const len = (s: string) => [...s].length
const word = (s: string) => Math.max(...s.split(/\s+/).map(len))

/** `font-size: clamp(9px, 2.6vw, 10px)` evaluated at a viewport width. */
const hudFont = (vw: number) => Math.min(10, Math.max(MIN_FONT, vw * 0.026))

const tables = { en, es } as const

describe.each(Object.entries(tables))('quest bottom bar (%s)', (_l, table) => {
  const key = (k: string) => table[k as PlainKey]
  it.each(WIDTHS)('keeps every item inside the frame at %i px', (vw) => {
    const inner = vw - HUD_SIDES
    const font = hudFont(vw)
    expect(font).toBeGreaterThanOrEqual(MIN_FONT)
    // The text buttons (End, Follow me) each fit alone on a row of the bar.
    for (const k of ['quest.end', 'quest.follow']) {
      expect(word(key(k)) * font + BUTTON_PAD, `${k} "${key(k)}"`).toBeLessThanOrEqual(inner)
    }
    // The button row wraps, so the fixed part is the two round buttons plus the End label.
    const row = 2 * HIT + BUTTON_GAP + BUTTON_GAP + len(key('quest.end')) * font + BUTTON_PAD
    expect(row, 'round buttons + End on one row').toBeLessThanOrEqual(inner)
    // The readout (two columns, labels at 6 px, values at 10 px) fits alone on its own row.
    const col = Math.max(len(key('quest.walked')) * 6, len(key('quest.steps')) * 6, len('123,45 km') * 10, len('99.999') * 10)
    expect(2 * col + 6, 'readout').toBeLessThanOrEqual(inner)
  })
})

describe('other button rows in Spanish and English', () => {
  const rows: Record<string, PlainKey[]> = {
    confirm: ['quest.endYes', 'quest.endNo'],
    crash: ['crash.retry', 'crash.reload'],
    complete: ['complete.new'],
  }
  it.each(Object.entries(tables))('wraps or fits each word at 320 px (%s)', (_l, table) => {
    const dialog = 320 - 2 * (6 + 3 + 8 + 10 + 4 + 16) // narrowest dialog content, generous
    for (const keys of Object.values(rows)) {
      for (const k of keys) expect(word(table[k]) * 10 + 40, `${k} "${table[k]}"`).toBeLessThanOrEqual(dialog + 40)
    }
  })
})

describe('style sheet rules for the bottom bar', () => {
  const css0 = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const body = (sel: string) => {
    const m = css0.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.\\()]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    expect(m, sel).toBeTruthy()
    return m![1]!
  }
  it('lets the bar wrap and its children shrink', () => {
    expect(body('.hud-bottom.folded')).toMatch(/flex-wrap:\s*wrap/)
    expect(body('.hud-bottom.folded .hud-stats')).toMatch(/minmax\(0,\s*1fr\)/)
    expect(body('.hud-stats')).toMatch(/min-width:\s*0/)
    expect(body('.hud-buttons')).toMatch(/flex-wrap:\s*wrap/)
    expect(body('.hud-buttons')).toMatch(/min-width:\s*0/)
    expect(body('.pix-btn')).toMatch(/max-width:\s*100%/)
  })
  it('shrinks the text button with a readable floor', () => {
    const rule = body('.hud-buttons .pix-btn:not(.round)')
    expect(rule).toMatch(/min-width:\s*0/)
    const clamp = rule.match(/font-size:\s*clamp\((\d+)px,\s*([\d.]+)vw,\s*(\d+)px\)/)
    expect(clamp).toBeTruthy()
    expect(Number(clamp![1])).toBeGreaterThanOrEqual(MIN_FONT)
    expect(Number(clamp![2]) / 100).toBeCloseTo(0.026)
    expect(Number(clamp![3])).toBe(10)
  })
})
