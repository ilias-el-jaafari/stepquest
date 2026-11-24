import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapRenderer } from '../render/MapRenderer.ts'
import { attachMapInput, type MapInputHandlers } from './mapInput.ts'

/** A stand-in renderer that records the camera calls the input makes. */
function fakeRenderer() {
  const r = {
    zoom: 16,
    cssWidth: 400,
    cssHeight: 300,
    zoomStep: vi.fn(),
    zoomTo: vi.fn((z: number) => void (r.zoom = z)),
    panBy: vi.fn(),
    screenToLatLon: vi.fn((x: number, y: number) => ({ lat: y, lon: x })),
  }
  return r
}

let canvas: HTMLCanvasElement
let handlers: { [K in keyof MapInputHandlers]: ReturnType<typeof vi.fn> }
let detach: () => void
let r: ReturnType<typeof fakeRenderer>

function pointer(type: string, id: number, x: number, y: number, extra: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: extra.pointerType ?? 'touch' } })
  if (extra.button !== undefined) Object.defineProperty(e, 'button', { value: extra.button })
  canvas.dispatchEvent(e)
}

beforeEach(() => {
  vi.useFakeTimers()
  canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
  canvas.setPointerCapture = () => {}
  r = fakeRenderer()
  handlers = { tap: vi.fn(), userPan: vi.fn(), view: vi.fn() }
  detach = attachMapInput(canvas, r as unknown as MapRenderer, () => handlers as unknown as MapInputHandlers)
})
afterEach(() => {
  detach()
  vi.useRealTimers()
})

describe('map input', () => {
  it('a short tap places a point; a drag pans and does not', () => {
    pointer('pointerdown', 1, 100, 100)
    pointer('pointerup', 1, 100, 100)
    expect(handlers.tap).toHaveBeenCalledTimes(1)
    pointer('pointerdown', 1, 100, 100)
    pointer('pointermove', 1, 130, 100)
    pointer('pointerup', 1, 130, 100)
    expect(r.panBy).toHaveBeenCalledWith(30, 0)
    expect(handlers.tap).toHaveBeenCalledTimes(1)
    expect(handlers.userPan).toHaveBeenCalled()
  })

  it('B13: a refused pointer capture does not break the gesture', () => {
    canvas.setPointerCapture = () => {
      throw new DOMException('gone', 'InvalidStateError')
    }
    expect(() => pointer('pointerdown', 1, 10, 10)).not.toThrow()
    pointer('pointerup', 1, 10, 10)
    expect(handlers.tap).toHaveBeenCalledTimes(1)
  })

  it('B13: right and middle mouse buttons neither pan nor place a point', () => {
    pointer('pointerdown', 1, 50, 50, { pointerType: 'mouse', button: 2 })
    pointer('pointerup', 1, 50, 50, { pointerType: 'mouse', button: 2 })
    expect(handlers.tap).not.toHaveBeenCalled()
  })

  it('a cancelled pointer is never a tap', () => {
    pointer('pointerdown', 1, 50, 50)
    pointer('pointercancel', 1, 50, 50)
    expect(handlers.tap).not.toHaveBeenCalled()
  })

  it('a second tap within 300 ms and 24 px zooms in and does not place a second point', () => {
    pointer('pointerdown', 1, 100, 100)
    pointer('pointerup', 1, 100, 100)
    vi.advanceTimersByTime(150)
    pointer('pointerdown', 1, 104, 102)
    pointer('pointerup', 1, 104, 102)
    expect(handlers.tap).toHaveBeenCalledTimes(1)
    expect(r.zoomStep).toHaveBeenCalledWith(1, 104, 102)
  })

  it('B1: small wheel deltas add up to one step; horizontal scroll does nothing', () => {
    const wheel = (deltaY: number, deltaX = 0) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaX, bubbles: true, cancelable: true }))
    for (let i = 0; i < 20; i++) wheel(-4)
    expect(r.zoomStep).not.toHaveBeenCalled()
    for (let i = 0; i < 10; i++) wheel(-4)
    expect(r.zoomStep).toHaveBeenCalledTimes(1)
    expect(r.zoomStep.mock.calls[0]![0]).toBe(1)
    r.zoomStep.mockClear()
    vi.advanceTimersByTime(1000)
    wheel(0, 50)
    expect(r.zoomStep).not.toHaveBeenCalled()
    wheel(100)
    expect(r.zoomStep.mock.calls[0]![0]).toBe(-1)
  })

  it('B2: a pinch zooms to the nearest level, pans with the midpoint, and does not flicker', () => {
    r.zoom = 8
    pointer('pointerdown', 1, 100, 150)
    pointer('pointerdown', 2, 200, 150)
    // Spread 1.41 times: between 8 and 16, but short of the 8 % margin past the midpoint.
    pointer('pointermove', 2, 241, 150)
    for (let i = 0; i < 5; i++) pointer('pointermove', 2, 241, 150)
    expect(r.zoomTo.mock.calls.length).toBeLessThanOrEqual(1)
    expect(r.panBy).toHaveBeenCalled() // the midpoint moved
    pointer('pointermove', 2, 400, 150)
    expect(r.zoom).toBeGreaterThan(8)
  })

  it('a fast flick glides on after release; reduced motion turns that off', () => {
    pointer('pointerdown', 1, 100, 100)
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(16)
      pointer('pointermove', 1, 100 + i * 20, 100)
    }
    r.panBy.mockClear()
    pointer('pointerup', 1, 200, 100)
    vi.advanceTimersByTime(100)
    expect(r.panBy.mock.calls.length).toBeGreaterThan(2)
    for (const c of r.panBy.mock.calls) expect(c[0]).toBeGreaterThan(0)
    vi.advanceTimersByTime(5000)
    const count = r.panBy.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(r.panBy.mock.calls.length).toBe(count) // it stopped
    expect(handlers.view).toHaveBeenCalled()

    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    pointer('pointerdown', 1, 100, 100)
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(16)
      pointer('pointermove', 1, 100 + i * 20, 100)
    }
    r.panBy.mockClear()
    pointer('pointerup', 1, 200, 100)
    vi.advanceTimersByTime(500)
    expect(r.panBy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a new touch stops a glide', () => {
    pointer('pointerdown', 1, 100, 100)
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(16)
      pointer('pointermove', 1, 100 + i * 20, 100)
    }
    pointer('pointerup', 1, 200, 100)
    vi.advanceTimersByTime(50)
    pointer('pointerdown', 1, 50, 50)
    r.panBy.mockClear()
    vi.advanceTimersByTime(500)
    expect(r.panBy).not.toHaveBeenCalled()
  })

  it('arrow keys pan 64 px and plus and minus zoom', () => {
    const key = (k: string) => canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    key('ArrowLeft')
    expect(r.panBy).toHaveBeenLastCalledWith(64, 0)
    key('ArrowDown')
    expect(r.panBy).toHaveBeenLastCalledWith(0, -64)
    key('+')
    expect(r.zoomStep).toHaveBeenLastCalledWith(1)
    key('-')
    expect(r.zoomStep).toHaveBeenLastCalledWith(-1)
    r.panBy.mockClear()
    key('a')
    expect(r.panBy).not.toHaveBeenCalled()
  })
})
