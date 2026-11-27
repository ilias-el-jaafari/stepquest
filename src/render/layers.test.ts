import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkKey, LruCache } from './chunkPlan.ts'
import { FrameScheduler } from './frameScheduler.ts'
import { FootprintLayer } from './footprintLayer.ts'
import { WalkerMotion } from './walkerMotion.ts'
import { installSoftCanvas } from './testing/softCanvas.ts'
import type { View } from './view.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('FrameScheduler', () => {
  it('coalesces requests into one frame and runs a request made inside a frame in the next one', () => {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let runs = 0
    const s: FrameScheduler = new FrameScheduler(() => {
      runs++
      if (runs === 1) s.request()
    })
    s.request()
    s.request()
    expect(queue).toHaveLength(1)
    queue.shift()!(0)
    expect(runs).toBe(1)
    expect(queue).toHaveLength(1) // not recursive: waits for the next frame
    queue.shift()!(0)
    expect(runs).toBe(2)
  })
  it('falls back to a timer without requestAnimationFrame, and can be cancelled', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const run = vi.fn()
    const s = new FrameScheduler(run)
    s.request()
    vi.advanceTimersByTime(20)
    expect(run).toHaveBeenCalledTimes(1)
    s.request()
    s.cancel()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('LruCache release hook', () => {
  it('reports every eviction and clear, with numeric keys', () => {
    const gone: number[] = []
    const c = new LruCache<string, number>(2, (k) => gone.push(k))
    c.set(chunkKey(0, 0), 'a')
    c.set(chunkKey(1, 0), 'b')
    c.set(chunkKey(2, 0), 'c')
    expect(gone).toEqual([chunkKey(0, 0)])
    c.clear()
    expect(gone.sort()).toEqual([chunkKey(0, 0), chunkKey(1, 0), chunkKey(2, 0)].sort())
  })
  it('chunk keys are unique per chunk', () => {
    const keys = new Set<number>()
    for (let cy = 0; cy < 40; cy++) for (let cx = 0; cx < 40; cx++) keys.add(chunkKey(cx, cy))
    expect(keys.size).toBe(1600)
  })
})

describe('WalkerMotion', () => {
  it('faces its movement, tweens between fixes and stops walking after a rest', () => {
    const m = new WalkerMotion()
    m.moveTo({ x: 10, y: 10 }, undefined, 0, false)
    expect(m.position(50)).toEqual({ x: 10, y: 10 })
    m.moveTo({ x: 14, y: 10 }, { x: 10, y: 10 }, 1000, false)
    expect(m.facing).toBe('right')
    expect(m.isTweening(1100)).toBe(true)
    expect(m.isWalking(1500, false)).toBe(true)
    // With no more fixes the walker settles (it does not stop dead mid-way) and the walk cycle ends.
    expect(m.isTweening(1000 + 5000)).toBe(false)
    expect(m.isWalking(1000 + 5000, false)).toBe(false)
    expect(m.isWalking(1500, true)).toBe(false)
  })
  it('jumps without a tween when the user prefers reduced motion', () => {
    const m = new WalkerMotion()
    m.moveTo({ x: 0, y: 0 }, undefined, 0, true)
    m.moveTo({ x: 5, y: 0 }, { x: 0, y: 0 }, 500, true)
    expect(m.position(500)).toEqual({ x: 5, y: 0 })
    expect(m.isTweening(500)).toBe(false)
  })
})

describe('FootprintLayer', () => {
  const line = Array.from({ length: 60 }, (_, i) => ({ cx: i + 0.5, cy: 2.5, along: i * 5 }))
  const view = (zoom: number, originX: number): View => ({ w: 300, h: 200, dpr: 1, zoom, cssW: 300, cssH: 200, scale: zoom, originX, originY: 40, camX: 0, camY: 0, detail: zoom >= 8 })

  it('lays the trail out once per zoom, not per frame or per pan', () => {
    const l = new FootprintLayer()
    l.setLine(line)
    const a = l.prints(16, 1)
    expect(l.prints(16, 1)).toBe(a)
    expect(l.prints(8, 1)).not.toBe(a)
  })
  it('draws one stamp per visible footprint and none off screen', () => {
    const restore = installSoftCanvas()
    const l = new FootprintLayer()
    l.setLine(line)
    const calls: string[] = []
    const ctx = { drawImage: () => calls.push('image'), fillRect: () => calls.push('rect'), globalAlpha: 1 } as unknown as CanvasRenderingContext2D
    const all = l.draw(ctx, view(16, 0), 1, -1)
    expect(calls.every((c) => c === 'image')).toBe(true)
    expect(all).toBe(calls.length)
    expect(all).toBeGreaterThan(20)
    expect(l.draw(ctx, view(16, -5000), 1, -1)).toBe(0)
    expect(l.draw(ctx, view(16, 0), 1, 1e9)).toBe(all)
    restore()
  })
})
