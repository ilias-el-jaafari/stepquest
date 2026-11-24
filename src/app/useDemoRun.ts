import { useEffect, useRef } from 'react'
import type { PlanResult } from '../routing/planner.ts'
import type { World } from '../ui/useMapData.ts'

type Args = {
  /** Whether this visit is the self-playing demo. */
  demo: boolean
  world: World | undefined
  /** The planned route, once there is one. */
  result: PlanResult | undefined
  plan: () => void
  /** Starts the quest on the planned route (with the demo's simulated walk). */
  start: () => void
  /** A quest is on screen. */
  questActive: boolean
}

/**
 * Plays the demo without input: once the bundled map is up it plans the loop, then starts the
 * simulated quest. Each step happens once; the quest, the camera and the summary run as usual.
 */
export function useDemoRun({ demo, world, result, plan, start, questActive }: Args) {
  const planned = useRef(false)
  const started = useRef(false)
  useEffect(() => {
    if (!demo || !world || planned.current) return
    planned.current = true
    plan()
  }, [demo, world, plan])
  useEffect(() => {
    if (!demo || started.current || questActive || !result?.ok) return
    started.current = true
    start()
  }, [demo, questActive, result, start])
}
