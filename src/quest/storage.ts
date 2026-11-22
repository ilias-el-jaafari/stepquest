import { APP_SLUG } from '../config/brand.ts'
import { QUEST_VERSION, type QuestState } from './quest.ts'

export const QUEST_STORAGE_KEY = `${APP_SLUG}.activeQuest`
/** A quest untouched for this long is considered abandoned. */
export const QUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function saveQuest(state: QuestState, store: StorageLike | undefined = storage()): boolean {
  if (!store) return false
  try {
    store.setItem(QUEST_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false // quota or privacy mode
  }
}

export function clearQuest(store: StorageLike | undefined = storage()): void {
  try {
    store?.removeItem(QUEST_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function isQuest(value: unknown): value is QuestState {
  if (!value || typeof value !== 'object') return false
  const q = value as Partial<QuestState>
  return (
    q.v === QUEST_VERSION &&
    typeof q.id === 'string' &&
    typeof q.startedAt === 'number' &&
    typeof q.collected === 'number' &&
    typeof q.strideM === 'number' &&
    !!q.route &&
    Array.isArray(q.route.points) &&
    q.route.points.length >= 2 &&
    Array.isArray(q.route.checkpoints) &&
    !!q.odometer &&
    typeof q.odometer.totalM === 'number' &&
    !!q.area
  )
}

/** Load a saved quest if it is valid and recent; otherwise clear it. */
export function loadQuest(now: number, store: StorageLike | undefined = storage()): QuestState | undefined {
  if (!store) return undefined
  let raw: string | null
  try {
    raw = store.getItem(QUEST_STORAGE_KEY)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isQuest(parsed)) throw new Error('invalid')
    const last = parsed.finishedAt ?? parsed.lastFixAt ?? parsed.startedAt
    if (now - last > QUEST_MAX_AGE_MS) throw new Error('stale')
    // Walked footprints from before a reroute are only decoration: drop them if malformed.
    const wb: unknown = parsed.walkedBefore
    const okTrail = (l: unknown) => Array.isArray(l) && l.every((p: { lat?: unknown; lon?: unknown } | null) => typeof p?.lat === 'number' && typeof p.lon === 'number')
    if (wb !== undefined && !(Array.isArray(wb) && wb.every(okTrail))) return { ...parsed, walkedBefore: undefined }
    return parsed
  } catch {
    clearQuest(store)
    return undefined
  }
}
