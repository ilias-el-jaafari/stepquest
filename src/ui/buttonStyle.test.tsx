import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { TileGrid } from '../tiles/grid.ts'
import { BUTTON_COLORS, CORNER_STEPS, INK, contrast, stepPolygon } from './buttonStyle.ts'
import { MapView } from './MapView.tsx'
import { SoundMenu } from './SoundMenu.tsx'
import { ICONS } from './pixelArt.ts'
import css from '../index.css?raw'
import steering from '../../.kiro/steering/visual-style.md?raw'

describe('console button colours', () => {
  it('gives an ink label at least 4.5:1 (WCAG AA) on every fill', () => {
    for (const [name, c] of Object.entries(BUTTON_COLORS)) expect(contrast(INK, c.fill), name).toBeGreaterThanOrEqual(4.5)
  })

  it('gives the disabled label (#4a4960) at least 4.5:1 on the grey fill', () => {
    expect(contrast('#4a4960', BUTTON_COLORS.grey.fill)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the light bevel lighter and the dark bevel darker than the fill', () => {
    for (const [name, c] of Object.entries(BUTTON_COLORS)) {
      expect(contrast(c.hi, '#000'), name).toBeGreaterThan(contrast(c.fill, '#000'))
      expect(contrast(c.lo, '#000'), name).toBeLessThan(contrast(c.fill, '#000'))
    }
  })

  it('matches the CSS variables and the steering document', () => {
    for (const [name, c] of Object.entries(BUTTON_COLORS)) {
      expect(css, name).toContain(`--btn-${name}: ${c.fill};`)
      expect(css, name).toContain(`--btn-${name}-hi: ${c.hi};`)
      expect(css, name).toContain(`--btn-${name}-lo: ${c.lo};`)
      expect(steering, name).toContain(c.fill)
    }
  })

  it('computes known contrast values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#777777', '#777777')).toBe(1)
  })
})

describe('console button shape', () => {
  it('writes the same staircase polygon in the CSS as the helper', () => {
    expect(css).toContain(`--btn-steps: ${stepPolygon()};`)
  })

  it('makes the polygon a staircase: every corner row is on a 3 px grid and never grows', () => {
    expect(CORNER_STEPS.every((o, i) => o % 3 === 0 && (i === 0 || o <= CORNER_STEPS[i - 1]!))).toBe(true)
    const pts = stepPolygon().slice('polygon('.length, -1).split(', ')
    expect(pts).toHaveLength((CORNER_STEPS.length * 2 + 1) * 4)
  })

  it('cuts the corners with clip-path and never with border-radius, and keeps a 48 px box', () => {
    const base = css.slice(css.indexOf('.pix-btn {\n  --fill'))
    const rule = base.slice(0, base.indexOf('}'))
    expect(rule).not.toMatch(/border-radius:\s*[1-9]/)
    expect(rule).toContain('min-height: var(--hit)')
    expect(css).toContain('clip-path: var(--btn-steps)')
    expect(css).toContain('--hit: 48px')
  })

  it('inverts the bevel and drops the label 2 px when pressed, with no transform', () => {
    const at = css.indexOf('.pix-btn:active:not(:disabled) {')
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toContain('--b1: var(--lo)')
    expect(rule).toContain('--b2: var(--hi)')
    expect(rule).toContain('padding-top: 8px')
    expect(rule).toContain('padding-bottom: 4px')
    expect(rule).not.toContain('transform')
  })

  it('keeps a visible focus outline', () => {
    expect(css).toMatch(/\.pix-btn:focus-visible \{\s*outline: 3px dashed var\(--gold\)/)
  })
})

describe('console button icons', () => {
  it('has original pixel icons for every icon action', () => {
    for (const n of ['plus', 'minus', 'fit', 'home', 'locate', 'soundOn', 'soundOff', 'play', 'pause', 'menu', 'close'] as const) {
      const rows = ICONS[n].rows
      expect(rows.some((r) => /[^.]/.test(r)), n).toBe(true)
    }
  })

  it('draws on/off and play/pause differently', () => {
    expect(ICONS.soundOn.rows).not.toEqual(ICONS.soundOff.rows)
    expect(ICONS.play.rows).not.toEqual(ICONS.pause.rows)
  })
})

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

describe('console buttons in the UI', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.setItem('stepquest.locale', 'en')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('makes the map controls round, named and drawn with a pixel icon (no text glyphs)', async () => {
    const grid = new TileGrid({ south: 39.49, west: -0.4, north: 39.5, east: -0.39 })
    const start = { lat: 39.491, lon: -0.399 }
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView grid={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="k" onTap={() => {}} home={start} onLocate={() => {}} />
        </I18nProvider>,
      ),
    )
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.map-buttons button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Show whole route', 'Go to the start', expect.any(String)])
    for (const b of buttons) {
      expect(b.classList.contains('pix-btn') && b.classList.contains('round')).toBe(true)
      expect(b.querySelector('svg[shape-rendering="crispEdges"]')).not.toBeNull()
      expect(b.textContent).toBe('')
    }
  })

  it('shows the sound button as a round icon without a label, and a pill with one', async () => {
    await act(async () =>
      root.render(
        <I18nProvider>
          <SoundMenu showLabel={false} />
          <SoundMenu showLabel />
        </I18nProvider>,
      ),
    )
    const [bare, labelled] = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="sound-button"]')]
    expect(bare!.classList.contains('round')).toBe(true)
    expect(labelled!.classList.contains('round')).toBe(false)
    expect(bare!.getAttribute('aria-label')).toBeTruthy()
    expect(bare!.querySelector('svg')).not.toBeNull()
  })
})
