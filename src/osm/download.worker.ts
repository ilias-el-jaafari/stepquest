// Downloads and converts a map area off the main thread, so the map stays smooth.
import type { BBox } from '../geo/geo.ts'
import type { CompactOsm } from './codec.ts'
import { DownloadError, downloadArea } from './download.ts'

export type WorkerRequest = { bbox: BBox; endpoints: string[] }
export type WorkerMessage =
  | { type: 'progress'; bytes: number }
  | { type: 'done'; data: CompactOsm }
  | { type: 'error'; code: DownloadError['code']; message: string }

const scope = self as unknown as { postMessage(m: WorkerMessage): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null }
let last = 0
scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const data = await downloadArea(e.data.bbox, {
      endpoints: e.data.endpoints,
      fetch: (input, init) => fetch(input, init),
      onProgress: (bytes) => {
        if (bytes - last < 64_000) return
        last = bytes
        scope.postMessage({ type: 'progress', bytes } satisfies WorkerMessage)
      },
    })
    scope.postMessage({ type: 'done', data } satisfies WorkerMessage)
  } catch (error) {
    const code = error instanceof DownloadError ? error.code : 'network'
    scope.postMessage({ type: 'error', code, message: error instanceof Error ? error.message : String(error) } satisfies WorkerMessage)
  }
}
