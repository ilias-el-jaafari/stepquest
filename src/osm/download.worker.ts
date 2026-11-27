// Off the main thread: Overpass downloads (parsed and converted) and vector tiles (fetched, decoded, converted).
import type { BBox } from '../geo/geo.ts'
import { encodeOsm, type CompactOsm } from './codec.ts'
import { DownloadError, downloadArea } from './download.ts'
import { fetchTileBytes, TileError } from '../vector/fetchTile.ts'
import { tileToOsm } from '../vector/omt.ts'
import type { TileId } from '../vector/tileMath.ts'
import { tileToLod, type LodTile } from '../lod/tile.ts'

/** `endpoints` are in the order to ask them. A tile request carries an id: one worker serves many tiles. */
export type WorkerRequest = { type: 'overpass'; bbox: BBox; endpoints: string[] } | { type: 'tile'; id: number; url: string; tile: TileId; coarse: boolean }
  | { type: 'lod'; id: number; url: string; tile: TileId }
export type WorkerMessage =
  | { type: 'progress'; bytes: number }
  | { type: 'mirror'; endpoint: string }
  | { type: 'done'; data: CompactOsm }
  | { type: 'error'; code: DownloadError['code']; message: string }
  | { type: 'tile'; id: number; data: string; bytes: number }
  | { type: 'lod'; id: number; data: LodTile; bytes: number }
  | { type: 'tileError'; id: number; code: TileError['code']; message: string }

const scope = self as unknown as { postMessage(m: WorkerMessage): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null }
let last = 0
scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (req.type === 'lod') {
    try {
      const bytes = await fetchTileBytes(req.url, (input, init) => fetch(input, init))
      const data = tileToLod(bytes, req.tile)
      const g = [data.streets, data.names, data.areas, data.waterways]
      const transfer = g.flatMap((x) => [x.kind.buffer, x.start.buffer, x.xy.buffer]) as unknown as Transferable[]
      ;(scope as unknown as { postMessage(m: WorkerMessage, t: Transferable[]): void }).postMessage({ type: 'lod', id: req.id, data, bytes: bytes.length } satisfies WorkerMessage, transfer)
    } catch (error) {
      const code = error instanceof TileError ? error.code : 'badResponse'
      scope.postMessage({ type: 'tileError', id: req.id, code, message: error instanceof Error ? error.message : String(error) } satisfies WorkerMessage)
    }
    return
  }
  if (req.type === 'tile') {
    try {
      const bytes = await fetchTileBytes(req.url, (input, init) => fetch(input, init))
      // JSON text: one flat copy to the page and into IndexedDB, not a nested array to clone there.
      const data = JSON.stringify(encodeOsm(tileToOsm(bytes, req.tile, { coarse: req.coarse })))
      scope.postMessage({ type: 'tile', id: req.id, data, bytes: bytes.length } satisfies WorkerMessage)
    } catch (error) {
      const code = error instanceof TileError ? error.code : 'badResponse'
      scope.postMessage({ type: 'tileError', id: req.id, code, message: error instanceof Error ? error.message : String(error) } satisfies WorkerMessage)
    }
    return
  }
  try {
    const data = await downloadArea(req.bbox, {
      endpoints: req.endpoints,
      fetch: (input, init) => fetch(input, init),
      onMirror: (endpoint) => scope.postMessage({ type: 'mirror', endpoint } satisfies WorkerMessage),
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
