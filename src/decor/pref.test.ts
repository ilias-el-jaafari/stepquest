import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decorOn, DECOR_STORAGE_KEY, parseDecorParam, resetDecorPref, setDecorOn, subscribeDecor } from './pref.ts'

beforeEach(() => {
  localStorage.clear()
  resetDecorPref()
})
afterEach(() => vi.unstubAllGlobals())

describe('decor setting', () => {
  it('is on by default and remembers a choice', () => {
    expect(decorOn()).toBe(true)
    setDecorOn(false)
    expect(localStorage.getItem(DECOR_STORAGE_KEY)).toBe('0')
    resetDecorPref()
    expect(decorOn()).toBe(false)
  })
  it('lets the URL win for the visit', () => {
    expect(parseDecorParam('?decor=0')).toBe(false)
    expect(parseDecorParam('?decor=off')).toBe(false)
    expect(parseDecorParam('?decor=1')).toBe(true)
    expect(parseDecorParam('?x=1')).toBeUndefined()
    expect(parseDecorParam('?decor=maybe')).toBeUndefined()
  })
  it('tells listeners', () => {
    const fn = vi.fn()
    const off = subscribeDecor(fn)
    setDecorOn(false)
    off()
    setDecorOn(true)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
