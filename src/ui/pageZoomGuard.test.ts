import { afterEach, describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import css from '../index.css?raw'
import { LOCKED_VIEWPORT, installPageZoomGuard } from './pageZoomGuard.ts'

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
const body = (selector: string) => {
  const m = stripped.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  return m?.[1] ?? ''
}

function fire(target: Element, type: string, touches?: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  if (touches !== undefined) Object.defineProperty(e, 'touches', { value: new Array(touches).fill({}) })
  target.dispatchEvent(e)
  return e
}

describe('page zoom guard', () => {
  let remove = () => {}
  afterEach(() => {
    remove()
    document.body.innerHTML = ''
  })
  const setup = () => {
    document.body.innerHTML = '<div class="app"><button id="b">x</button></div><div class="map"><canvas class="map-canvas" id="c"></canvas></div>'
    remove = installPageZoomGuard(document)
    return { button: document.getElementById('b')!, canvas: document.getElementById('c')! }
  }

  it('prevents Safari gesture events outside the canvas and leaves them on the canvas', () => {
    const { button, canvas } = setup()
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      expect(fire(button, type).defaultPrevented).toBe(true)
      expect(fire(document.body, type).defaultPrevented).toBe(true)
      expect(fire(canvas, type).defaultPrevented).toBe(false)
    }
  })

  it('blocks multi-touch moves outside the canvas only', () => {
    const { button, canvas } = setup()
    expect(fire(button, 'touchmove', 2).defaultPrevented).toBe(true)
    expect(fire(button, 'touchstart', 2).defaultPrevented).toBe(true)
    expect(fire(canvas, 'touchmove', 2).defaultPrevented).toBe(false)
  })

  it('lets a one-finger touch through everywhere', () => {
    const { button, canvas } = setup()
    expect(fire(button, 'touchmove', 1).defaultPrevented).toBe(false)
    expect(fire(canvas, 'touchmove', 1).defaultPrevented).toBe(false)
  })

  it('stops blocking once removed', () => {
    const { button } = setup()
    remove()
    expect(fire(button, 'gesturestart').defaultPrevented).toBe(false)
  })
})

describe('viewport meta', () => {
  const content = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1]
  it('locks page scale and keeps viewport-fit=cover', () => {
    const parts = content!.split(',').map((s) => s.trim())
    expect(parts).toEqual(expect.arrayContaining(['width=device-width', 'initial-scale=1', 'maximum-scale=1', 'user-scalable=no', 'viewport-fit=cover']))
  })
  it('matches the content the guard restores', () => {
    expect(content).toBe(LOCKED_VIEWPORT)
  })
})

describe('touch-action rules', () => {
  it('is none on the map canvas only', () => {
    expect(body('.map-canvas')).toMatch(/touch-action:\s*none/)
    const none = [...stripped.matchAll(/([^{}]+)\{[^}]*touch-action:\s*none/g)].map((m) => m[1]!.trim())
    expect(none).toEqual(['.map-canvas'])
  })
  it('is manipulation on the app root and on controls', () => {
    expect(body('.app')).toMatch(/touch-action:\s*manipulation/)
    expect(stripped).toMatch(/button,[^{]*\{[^}]*touch-action:\s*manipulation/)
  })
})

describe('minimum font size', () => {
  it('has no text below 7px', () => {
    const sizes = [...stripped.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(7)
  })
})
