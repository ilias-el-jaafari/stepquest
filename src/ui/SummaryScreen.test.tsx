import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, audioEngine, setAudioEngineForTests } from '../audio/engine.ts'
import { DEFAULT_AUDIO } from '../audio/settings.ts'
import { en, type PlainKey } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { I18nProvider } from '../i18n/index.ts'
import { summarize, type Summary } from '../quest/summary.ts'
import { WALKER } from '../render/sprites.ts'
import { SummaryScreen } from './SummaryScreen.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
const done: Summary = summarize({ walkedM: 7560, steps: 10080, elapsedMs: 95 * 60_000, paceMinPerKm: 12.57, collected: 10, total: 10 }, 'complete')
const paused: Summary = summarize({ walkedM: 1200, steps: 1600, elapsedMs: 15 * 60_000, paceMinPerKm: 12.5, collected: 2, total: 10 }, 'paused')

function stubCanvas() {
  const fillRect = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), fillRect, globalAlpha: 1, fillStyle: '' } as unknown as CanvasRenderingContext2D)
  return fillRect
}

async function show(summary: Summary, locale: 'en' | 'es' = 'en', on = { back: vi.fn(), next: vi.fn() }) {
  localStorage.setItem('stepquest.locale', locale)
  await act(async () => root.render(<I18nProvider><SummaryScreen summary={summary} walker={WALKER.down[0]!} seed={7} onBack={on.back} onNew={on.next} /></I18nProvider>))
  return on
}
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  setAudioEngineForTests(new AudioEngine(DEFAULT_AUDIO))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SummaryScreen', () => {
  it('renders the stats, the title and the two buttons', async () => {
    const on = await show(done)
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector(`[id="${dialog.getAttribute('aria-labelledby')}"]`)?.textContent).toBe('Quest complete!')
    expect(q('summary-distance').textContent).toBe('7.56 km')
    expect(q('summary-steps').textContent).toBe('10,080')
    expect(q('summary-time').textContent).toBe('1:35:00')
    expect(q('summary-pace').textContent).toContain('12\'34"')
    expect(q('summary-gems').textContent).toBe('10/10')
    expect(q('summary-title').textContent).toContain('Grand Wayfarer')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back to map', 'Plan another quest'])
    expect(dialog.contains(document.activeElement)).toBe(true)
    await act(async () => q('summary-back').click())
    await act(async () => q('summary-new').click())
    expect(on.back).toHaveBeenCalledTimes(1)
    expect(on.next).toHaveBeenCalledTimes(1)
  })

  it('shows the gentler variant when paused', async () => {
    await show(paused)
    expect(host.textContent).toContain('Quest paused')
    expect(host.textContent).not.toContain('Quest complete!')
    expect(q('summary-gems').textContent).toBe('2/10')
    expect(q('summary-title').textContent).toContain('Gem Seeker')
    expect(host.querySelector('.summary-hero.hop')).toBeNull()
    expect(host.querySelector('.summary-ghost.spin')).toBeNull()
    expect(host.querySelector('[data-testid="summary-ghost-say"]')).toBeNull()
  })

  it('speaks Spanish', async () => {
    await show(done, 'es')
    expect(host.textContent).toContain('¡Misión completada!')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Volver al mapa', 'Planear otra misión'])
  })

  it('animates the hero and the canvas by default', async () => {
    stubCanvas()
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1)
    await show(done)
    expect(q('complete').dataset.motion).toBe('live')
    expect(host.querySelector('.summary-hero.hop')).not.toBeNull()
    // The ghost spins and sparkles at the finish.
    expect(host.querySelector('.summary-ghost.spin')).not.toBeNull()
    expect(host.querySelectorAll('.spark').length).toBeGreaterThan(0)
    expect(q('summary-ghost-say').textContent).toBe(en['ghost.finish'])
    expect(raf).toHaveBeenCalled()
  })

  it('draws one still frame with reduced motion: no loop, no hopping hero', async () => {
    const fillRect = stubCanvas()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }))
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    await show(done)
    expect(q('complete').dataset.motion).toBe('still')
    expect(host.querySelector('.summary-hero.hop')).toBeNull()
    expect(host.querySelector('.summary-ghost.spin')).toBeNull()
    expect(host.querySelectorAll('.spark')).toHaveLength(0)
    expect(raf).not.toHaveBeenCalled()
    expect(fillRect).toHaveBeenCalled()
  })

  it('plays the fanfare, or the soft phrase when paused, once per opening', async () => {
    const play = vi.spyOn(audioEngine(), 'playSfx')
    await show(done)
    expect(play.mock.calls).toEqual([['fanfare']])
    await act(async () => root.render(<></>))
    play.mockClear()
    await show(paused)
    expect(play.mock.calls).toEqual([['rest']])
  })

  it('is silent with the sound off and still opens', async () => {
    const muted = new AudioEngine({ ...DEFAULT_AUDIO, muted: true })
    setAudioEngineForTests(muted)
    const play = vi.spyOn(muted, 'playSfx')
    await show(done)
    expect(play).toHaveBeenCalled()
    expect(q('complete')).not.toBeNull()
  })
})

describe('copy fit', () => {
  // Press Start 2P is square: a text of n characters is n × font-size px wide.
  const GLYPH = { h2: 14, lead: 8, title: 11, label: 7, value: 11, button: 10 }
  const len = (s: string) => [...s].length
  const word = (s: string) => Math.max(...s.split(/\s+/).map(len))
  const lines = (s: string, perLine: number) => {
    let n = 1
    let used = 0
    for (const w of s.split(/\s+/)) {
      if (used > 0 && used + 1 + len(w) > perLine) {
        n++
        used = len(w)
      } else used += (used ? 1 : 0) + len(w)
    }
    return n
  }
  const TITLES = ['scout', 'hero', 'wayfarer', 'legend', 'swift', 'fresh', 'seeker']
  // 12 px page padding and 4 px panel outline plus 14 px box padding on each side.
  it.each([
    [320, 568],
    [390, 844],
  ])('fits %i×%i in both languages', (vw, vh) => {
    const inner = vw - 2 * (12 + 4 + 14)
    const column = (inner - 8) / 2
    for (const table of [en, es]) {
      const t = (k: string) => table[k as PlainKey]
      for (const k of ['summary.title.complete', 'summary.title.paused']) expect(word(t(k)) * GLYPH.h2, k).toBeLessThanOrEqual(inner)
      for (const k of ['summary.lead.complete', 'summary.lead.paused']) expect(word(t(k)) * GLYPH.lead, k).toBeLessThanOrEqual(inner)
      for (const id of TITLES) expect(word(t(`summary.t.${id}`)) * GLYPH.title, id).toBeLessThanOrEqual(inner - 12)
      for (const k of ['summary.distance', 'summary.steps', 'summary.time', 'summary.pace', 'summary.gems', 'summary.earned']) expect(len(t(k)) * GLYPH.label, k).toBeLessThanOrEqual(column)
      // The widest values: "123,45 km" and a pace such as 12'34"/km.
      expect(9 * GLYPH.value).toBeLessThanOrEqual(column)
      expect(7 * GLYPH.value + 3 * GLYPH.label).toBeLessThanOrEqual(column)
      for (const k of ['summary.back', 'summary.new']) expect(word(t(k)) * GLYPH.button, k).toBeLessThanOrEqual(inner - 24)

      // Height: padding, hero, heading, lead, title card, three stat rows, two buttons (each up to two lines).
      const perLine = (px: number) => Math.floor(inner / px)
      const longestLead = Math.max(...['summary.lead.complete', 'summary.lead.paused'].map((k) => lines(t(k), perLine(GLYPH.lead))))
      const height =
        2 * 12 + 2 * 14 + 8 + 48 + 14 + lines(t('summary.title.complete'), perLine(GLYPH.h2)) * 14 * 1.3 + 14 + longestLead * 8 * 1.5 + 10 + 90 + 12 + 3 * 28 + 12 + 2 * (2 * 10 + 24) + 8
      expect(height).toBeLessThanOrEqual(vh)
    }
  })
})
