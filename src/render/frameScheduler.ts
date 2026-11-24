/**
 * Coalesces frame requests into one callback per animation frame. A request made
 * while a frame is running is honoured in the next frame, never recursively, and
 * without `requestAnimationFrame` (scripts, tests) frames run on a 16 ms timer.
 */
export class FrameScheduler {
  private handle: number | ReturnType<typeof setTimeout> | undefined
  private usingRaf = false

  private readonly run: () => void

  constructor(run: () => void) {
    this.run = run
  }

  get pending(): boolean {
    return this.handle !== undefined
  }

  request(): void {
    if (this.handle !== undefined) return
    const tick = () => {
      this.handle = undefined
      this.run()
    }
    if (typeof requestAnimationFrame === 'function') {
      this.usingRaf = true
      this.handle = requestAnimationFrame(tick)
    } else {
      this.usingRaf = false
      this.handle = setTimeout(tick, 16)
    }
  }

  cancel(): void {
    if (this.handle === undefined) return
    if (this.usingRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.handle as number)
    } else clearTimeout(this.handle as ReturnType<typeof setTimeout>)
    this.handle = undefined
  }
}
