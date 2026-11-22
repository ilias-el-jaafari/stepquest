import { useSyncExternalStore } from 'react'
import { loadLook, saveLook, type Look } from './look.ts'

let current: Look | undefined
const listeners = new Set<() => void>()

function get(): Look {
  current ??= loadLook()
  return current
}

/** Change the walker's look everywhere (map, header, Hero tab) and save it. */
export function setLook(look: Look): void {
  current = look
  saveLook(look)
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
