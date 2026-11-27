import { APP_SLUG } from '../config/brand.ts'

/**
 * The "Halloween decor" setting (halloween-decor spec, H9): on by default, kept in localStorage, and
 * overridden for a visit by `?decor=0` or `?decor=1` in the URL. A tiny external store so the map and
 * the Settings tab stay in step without going through the app reducer.
 */
export const DECOR_STORAGE_KEY = `${APP_SLUG}.decor`

/** `?decor=0|off|false` is off, `?decor=1|on|true` is on, anything else is not set. */
export function parseDecorParam(search: string): boolean | undefined {
  const v = new URLSearchParams(search).get('decor')?.toLowerCase()
  if (v === undefined) return undefined
  if (v === '0' || v === 'off' || v === 'false') return false
  if (v === '1' || v === 'on' || v === 'true') return true
  return undefined
}

function stored(): boolean {
  try {
    return localStorage.getItem(DECOR_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

let value: boolean | undefined
const listeners = new Set<() => void>()

export function decorOn(): boolean {
  if (value === undefined) value = (typeof location !== 'undefined' ? parseDecorParam(location.search) : undefined) ?? stored()
  return value
}

export function setDecorOn(on: boolean): void {
  value = on
  try {
    localStorage.setItem(DECOR_STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Private mode can block storage; the choice lasts for this visit.
  }
  for (const fn of [...listeners]) fn()
}

export function subscribeDecor(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** For tests: forget the cached value so the next read starts from storage and the URL again. */
export function resetDecorPref(): void {
  value = undefined
}
