import { AVOID_STORAGE_KEY } from '../config/brand.ts'
import { normalizeName } from '../routing/safety.ts'

/** Most streets one can keep on the avoid list. */
export const MAX_AVOID = 50

/** Clean a stored list: strings only, trimmed, no duplicates (ignoring case and accents). */
export function sanitizeAvoid(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const name = v.trim().replace(/\s+/g, ' ')
    const key = normalizeName(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= MAX_AVOID) break
  }
  return out
}

export function addAvoid(list: readonly string[], name: string): string[] {
  return sanitizeAvoid([...list, name])
}

export function removeAvoid(list: readonly string[], name: string): string[] {
  const key = normalizeName(name)
  return list.filter((n) => normalizeName(n) !== key)
}

export function loadAvoid(): string[] {
  try {
    const raw = localStorage.getItem(AVOID_STORAGE_KEY)
    return raw ? sanitizeAvoid(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveAvoid(list: readonly string[]): void {
  try {
    localStorage.setItem(AVOID_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage may be blocked (private mode); the list then lasts for this visit.
  }
}
