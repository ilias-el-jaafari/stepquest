import { addStepsToday } from './dailySteps.ts'
import { applyFix } from './machine.ts'
import { applyReroute, type ReroutePatch } from './reroute.ts'
import { clearQuest, saveQuest } from './storage.ts'
import { DEFAULT_QUEST_CONFIG, type QuestConfig, type QuestEvent, type QuestState } from './state.ts'
import { stepsWalked } from './stats.ts'
import type { GpsFix } from './types.ts'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type SessionDeps = {
  /** Where the quest is saved (default: localStorage). */
  store?: StorageLike
  /** Adds walked steps to "steps today" for the day of `atMs` (default: the device's daily total). */
  credit?: (steps: number, atMs: number) => void
  /** Wall clock, for the save throttle. */
  now?: () => number
  /** Saves between events happen at most this often. */
  saveEveryMs?: number
  config?: QuestConfig
}

export type FixOutcome = {
  /** The state before this fix. */
  prev: QuestState
  /** The state after it (also saved, when `saved`). */
  state: QuestState
  events: QuestEvent[]
  /** The fix asked for a quiet reroute; call `startReroute` for the request. */
  wantsReroute: boolean
  saved: boolean
}

/**
 * The quest controller without React or Web Audio: one running quest plus the rules around it.
 * - applies fixes through the state machine (`applyFix`) and ignores late ones after the finish;
 * - saves at once on a pickup, the finish or a reroute, otherwise at most once per `saveEveryMs`;
 * - adds the walked steps of a real quest to "steps today" as they happen, once (`creditedSteps`),
 *   for the day of the latest fix;
 * - numbers reroute requests (the newest wins) and applies a patch only if `applyReroute` accepts it.
 */
export class QuestSession {
  private current: QuestState
  private lastSave = Number.NEGATIVE_INFINITY
  private ticket = 0
  private ended = false
  private readonly deps: Required<Pick<SessionDeps, 'saveEveryMs' | 'config'>> & SessionDeps

  constructor(initial: QuestState, deps: SessionDeps = {}) {
    this.current = initial
    this.deps = { saveEveryMs: 1000, config: DEFAULT_QUEST_CONFIG, ...deps }
  }

  get state(): QuestState {
    return this.current
  }

  get running(): boolean {
    return !this.ended && this.current.finishedAt === undefined
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Save now (and credit the steps walked since the last save). */
  save(): void {
    if (this.ended) return
    this.current = this.credited(this.current)
    this.lastSave = this.now()
    saveQuest(this.current, this.deps.store)
  }

  private credited(q: QuestState): QuestState {
    if (q.simulated) return q
    const unpaid = stepsWalked(q) - (q.creditedSteps ?? 0)
    if (!(unpaid > 0)) return q
    try {
      ;(this.deps.credit ?? addStepsToday)(unpaid, q.lastFixAt ?? this.now())
    } catch {
      return q // try again at the next save
    }
    return { ...q, creditedSteps: (q.creditedSteps ?? 0) + unpaid }
  }

  /** Feed a fix. After the finish, or the end of the session, nothing changes. */
  handleFix(fix: GpsFix): FixOutcome {
    const prev = this.current
    if (this.ended || prev.finishedAt !== undefined) return { prev, state: prev, events: [], wantsReroute: false, saved: false }
    const applied = applyFix(prev, fix, this.deps.config)
    this.current = applied.state
    const important = applied.events.some((e) => e.type === 'collected' || e.type === 'finished')
    const due = important || this.now() - this.lastSave > this.deps.saveEveryMs
    if (due) this.save()
    return { prev, state: this.current, events: applied.events, wantsReroute: applied.events.some((e) => e.type === 'reroute'), saved: due }
  }

  /** Begin a reroute request for the current state; any request still open becomes stale. */
  startReroute(): { ticket: number; snapshot: QuestState } {
    return { ticket: ++this.ticket, snapshot: this.current }
  }

  /** Drop every open reroute request. */
  cancelReroute(): void {
    this.ticket++
  }

  /** Merge the answer of request `ticket`. Undefined (and nothing changes) when it is stale or no longer fits. */
  settleReroute(ticket: number, patch: ReroutePatch | undefined): QuestState | undefined {
    if (!patch || this.ended || ticket !== this.ticket) return undefined
    const next = applyReroute(this.current, patch)
    if (!next) return undefined
    this.current = next
    this.save()
    return this.current
  }

  /** Swap the running state (for example, a real quest switched to the simulator). */
  replace(next: QuestState): void {
    this.cancelReroute()
    this.current = next
    this.save()
  }

  /** Leave the quest: credit the steps still unpaid, forget the save, drop open requests. */
  end(): void {
    if (this.ended) return
    this.current = this.credited(this.current)
    this.ended = true
    this.ticket++
    clearQuest(this.deps.store)
  }

  /** Stop without clearing the save (page closed, component unmounted). */
  dispose(): void {
    if (this.ended) return
    this.save()
    this.ended = true
    this.ticket++
  }
}
