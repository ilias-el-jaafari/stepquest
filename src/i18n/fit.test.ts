import { describe, expect, it } from 'vitest'
import { en, type PlainKey } from './en.ts'
import { es } from './es.ts'

/**
 * Overflow check for the pixel-font UI without a layout engine. Press Start 2P is
 * monospace and square: every glyph is as wide as the font size is tall, so a label of
 * `n` characters is `n × font-size` px wide. Buttons wrap between words, so what can
 * overflow is the longest single word (and, for tabs, which never wrap, the whole label).
 *
 * Geometry at the narrowest supported phone, from `src/index.css`:
 * - the screen is 390 px wide;
 * - `.pix-btn` has 20 px of padding on each side and a 10 px label;
 * - the planner content is about 334 px wide (screen minus frame and box padding);
 * - the tab bar splits 390 px in four and each `.tab` has 2 px of padding and a 7 px label.
 */
const SCREEN_PX = 390
const GLYPH = { button: 10, tab: 7 } as const
const BUTTON_PAD = 40
const CONTENT_PX = 334
const SEGMENT_GAP = 8

const charsThatFit = (widthPx: number, glyphPx: number) => Math.floor(widthPx / glyphPx)
const longestWord = (text: string) => Math.max(...text.split(/\s+/).map((w) => [...w].length))
const length = (text: string) => [...text].length

const TABS: PlainKey[] = ['tab.map', 'tab.bag', 'tab.hero', 'tab.settings']
/** Buttons that sit two per row (mode, start/finish, body type). */
const TWO_UP: PlainKey[] = ['mode.loop', 'mode.oneway', 'place.start', 'place.end', 'look.boy', 'look.girl']
/** Every other text button, one per row at full width (they may wrap onto a second line). */
const WIDE: PlainKey[] = [
  'action.generate', 'action.planning', 'action.reroll', 'quest.start', 'quest.simulate', 'quest.end', 'quest.useSim', 'complete.new',
  'sound.test', 'sound.mute', 'sound.voiceOnly', 'sound.close', 'onboarding.skip', 'onboarding.back', 'onboarding.next', 'onboarding.start',
  'onboarding.show', 'data.load', 'data.loading', 'data.backToDemo', 'loc.use', 'loc.locating', 'planner.edit', 'planner.hide',
  'area.load', 'safety.pick', 'safety.cancel', 'safety.useNormal', 'info.button', 'info.close', 'bag.demo',
]

describe.each([
  ['en', en],
  ['es', es],
] as const)('labels fit the 390 px screen (%s)', (_locale, table) => {
  it('keeps every tab label inside its quarter of the tab bar', () => {
    const limit = charsThatFit(SCREEN_PX / 4 - 4, GLYPH.tab)
    for (const key of TABS) expect(length(table[key]), `${key} "${table[key]}"`).toBeLessThanOrEqual(limit)
  })

  it('keeps every word of a two-per-row button inside the button', () => {
    const buttonPx = (CONTENT_PX - SEGMENT_GAP) / 2
    const limit = charsThatFit(buttonPx - BUTTON_PAD, GLYPH.button)
    for (const key of TWO_UP) expect(longestWord(table[key]), `${key} "${table[key]}"`).toBeLessThanOrEqual(limit)
  })

  it('keeps every word of a full-width button inside it, and the label to two lines', () => {
    const perLine = charsThatFit(CONTENT_PX - BUTTON_PAD, GLYPH.button)
    for (const key of WIDE) {
      expect(longestWord(table[key]), `${key} "${table[key]}"`).toBeLessThanOrEqual(perLine)
      expect(length(table[key]), `${key} "${table[key]}"`).toBeLessThanOrEqual(perLine * 2)
    }
  })
})

describe('the Spanish labels stay near the English length', () => {
  it('is at most 1.8 times as long as English for every button and tab (plus 4 characters for short words)', () => {
    for (const key of [...TABS, ...TWO_UP, ...WIDE]) {
      expect(length(es[key]), key).toBeLessThanOrEqual(length(en[key]) * 1.8 + 4)
    }
  })
})
