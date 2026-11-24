import { afterEach, describe, expect, it } from 'vitest'
import { LOOK_STORAGE_KEY, type Look } from './look.ts'
import { getLook, resetLookForTests, setLook } from './useLook.ts'

describe('useLook (review)', () => {
  afterEach(() => {
    localStorage.clear()
    resetLookForTests()
  })

  it('B9: setLook keeps only a valid look in memory and in storage', () => {
    setLook({ body: 'robot', skin: 99, hair: 2, cap: -1, shirt: 1.5, pants: 3 } as unknown as Look)
    expect(getLook()).toEqual({ body: 'boy', skin: 0, hair: 2, cap: 0, shirt: 0, pants: 3 })
    expect(JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY)!).skin).toBe(0)
  })
})
