/** Minimal binary min-heap keyed by number, storing integer payloads. */
export class MinHeap {
  private keys: number[] = []
  private vals: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, val: number): void {
    const keys = this.keys
    const vals = this.vals
    let i = keys.length
    keys.push(key)
    vals.push(val)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((keys[parent] ?? 0) <= key) break
      keys[i] = keys[parent] ?? 0
      vals[i] = vals[parent] ?? 0
      i = parent
    }
    keys[i] = key
    vals[i] = val
  }

  /** Remove and return the payload with the smallest key (undefined when empty). */
  pop(): number | undefined {
    const keys = this.keys
    const vals = this.vals
    if (keys.length === 0) return undefined
    const top = vals[0]
    const lastKey = keys.pop() ?? 0
    const lastVal = vals.pop() ?? 0
    const n = keys.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && (keys[r] ?? 0) < (keys[l] ?? 0) ? r : l
        if ((keys[c] ?? 0) >= lastKey) break
        keys[i] = keys[c] ?? 0
        vals[i] = vals[c] ?? 0
        i = c
      }
      keys[i] = lastKey
      vals[i] = lastVal
    }
    return top
  }
}
