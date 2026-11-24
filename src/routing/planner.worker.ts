// Plans routes and reroutes off the main thread, so the map and the GPS handler stay smooth.
import type { PlanRequest, PlanResponse } from './planProtocol.ts'
import { PlanService } from './planService.ts'

const service = new PlanService()
const scope = self as unknown as { postMessage(m: PlanResponse): void; onmessage: ((e: MessageEvent<PlanRequest>) => void) | null }
scope.onmessage = (e: MessageEvent<PlanRequest>) => {
  const answer = service.handle(e.data)
  if (answer) scope.postMessage(answer)
}
