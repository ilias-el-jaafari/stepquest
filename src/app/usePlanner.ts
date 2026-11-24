import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { isNightWalk } from '../geo/sun.ts'
import { PlanClient } from '../routing/planClient.ts'
import { planWithSafety } from '../routing/safePlanner.ts'
import type { RouteRequest } from '../routing/planner.ts'
import type { World } from '../ui/useMapData.ts'
import { WALK_KMH } from './constants.ts'
import { WalkAreaError, type WalkProgress } from '../world/walkArea.ts'
import type { AppAction, AppState, PlanError } from './appState.ts'
import type { WalkNeed } from './useArea.ts'

/** Whether the walk starts or ends after sunset (from the start point's sun), so lighting counts more. */
export function walkIsAtNight(start: LatLon, now: number, steps: number, strideM: number): boolean {
  const walkMs = (stepsToMetres(steps, strideM) / 1000 / WALK_KMH) * 3_600_000
  return isNightWalk(now, walkMs, start)
}

/** The route search itself (not the streets) is given this long before the player is told (requirement 12.4). */
export const SEARCH_DEADLINE_MS = 60_000

/** What a failed plan tells the player: the streets would not load, took too long, or the search broke. */
export function planErrorOf(error: unknown): PlanError {
  if (error instanceof WalkAreaError) return error.code === 'timeout' ? 'timeout' : 'streets'
  if (error instanceof PlanTimeout) return 'timeout'
  return 'failed'
}

class PlanTimeout extends Error {}

type Args = {
  world: World | undefined
  /** Makes sure the streets the walk needs are on the device; resolves with the world to plan on (requirement 12.2). */
  ensureWalk?: (need: WalkNeed, onProgress?: (p: WalkProgress) => void) => Promise<World | undefined>
  latest: RefObject<AppState>
  dispatch: (action: AppAction) => void
  /** Validates the number fields and returns what to plan with. */
  commitFields: () => { targetSteps: number; strideM: number }
  /** Called after a route was planned and is still wanted (for example to scroll the map into view). */
  onPlanned?: () => void
  /** Fixes the "walk at night" choice instead of reading the clock (the self-playing demo plans the same route every time). */
  night?: boolean
}

/**
 * Planning and rerouting run in a Web Worker (or on the main thread where there is none).
 * `plan` is safe to call twice in a row: the second call finds a request already out.
 */
export function usePlanner({ world, ensureWalk, latest, dispatch, commitFields, onPlanned, night: fixedNight }: Args) {
  const client = useRef<PlanClient>(undefined)
  client.current ??= new PlanClient()
  useEffect(() => {
    const c = client.current
    return () => c?.dispose()
  }, [])
  const planned = useRef(onPlanned)
  useEffect(() => {
    planned.current = onPlanned
  })

  const plan = useCallback(
    (reroll = false) => {
      const planClient = client.current
      if (!world || !planClient || latest.current.plan.status === 'running') return
      if (latest.current.settings.mode === 'oneway' && !latest.current.end) return
      // Typed text is validated first; that may change the settings and so number the request again.
      const { targetSteps, strideM } = commitFields()
      const s = latest.current
      const seed = reroll ? s.plan.seed + 1 : s.plan.seed
      const token = s.plan.token + 1
      dispatch({ type: 'planStart', token, seed })
      // Safe routing is always on. From sunset to sunrise (at the start or by the estimated end
      // of the walk) lighting counts more, automatically.
      const night = fixedNight ?? walkIsAtNight(s.start, Date.now(), targetSteps, strideM)
      const req: RouteRequest = { mode: s.settings.mode, start: s.start, end: s.settings.mode === 'oneway' ? s.end : undefined, targetSteps, strideM, seed }
      const opts = { safe: true, night, avoid: [...s.avoid] }
      void (async () => {
        try {
          // The streets of the walk first (nothing to do when they are on the device), then the search.
          let map = world
          if (ensureWalk) {
            const need: WalkNeed = { start: s.start, end: req.end, targetSteps, strideM }
            const loaded = await ensureWalk(need, (progress) => dispatch({ type: 'planProgress', token, phase: 'streets', progress }))
            if (loaded) map = loaded
            dispatch({ type: 'planProgress', token, phase: 'route' })
          }
          // The search runs in the worker, so the button repaints and the map keeps moving meanwhile.
          let timer: ReturnType<typeof setTimeout> | undefined
          const outcome = await Promise.race([
            planClient.plan(map, req, map.data.bbox, opts),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new PlanTimeout('The search took too long')), SEARCH_DEADLINE_MS)
            }),
          ]).finally(() => clearTimeout(timer))
          if (outcome.status === 'stale') {
            dispatch({ type: 'planCancelled', token })
            return
          }
          const sp = outcome.status === 'ok' ? outcome.value : planWithSafety(map.graph, map.safety, req, map.data.bbox, opts)
          dispatch({ type: 'planDone', token, plan: sp })
          // Only when the answer was still wanted (the reducer drops it otherwise).
          if (latest.current.plan.token === token && latest.current.result === sp.result) planned.current?.()
        } catch (error) {
          dispatch({ type: 'planFailed', token, error: planErrorOf(error) })
        }
      })()
    },
    [world, ensureWalk, latest, dispatch, commitFields, fixedNight],
  )

  const reroute = useCallback(
    async (q: Parameters<PlanClient['reroute']>[1]) => {
      if (!world || !client.current) return undefined
      const outcome = await client.current.reroute(world, q, latest.current.avoid, Date.now())
      return outcome.status === 'ok' ? outcome.value : undefined
    },
    [world, latest],
  )

  return { plan, reroute }
}
