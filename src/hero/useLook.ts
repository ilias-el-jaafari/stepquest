import { useSyncExternalStore } from 'react'
import { loadLook, normalizeLook, saveLook, type Look } from './look.ts'

let current: Look | undefined
const listeners = new Set<() => void>()

function get(): Look {
  current ??= loadLook()
  return current
}

/** The look in use now (the same object until it changes). */
export const getLook = get

/** Change the walker's look everywhere (map, header, Hero tab) and save it. */
export function setLook(look: Look): void {
  current = normalizeLook(look)
  saveLook(current)
  for (const l of listeners) l()
}

/** Forget the in-memory look (tests reset storage between runs). */
export function resetLookForTests(): void {
  current = undefined
}

export function useLook(): Look {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    get,
    get,
  )
}
