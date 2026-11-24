/**
 * A small software canvas for tests (no native canvas in the test runtime).
 * It implements exactly what the map renderer uses: fillRect, drawImage with
 * nearest-neighbour scaling, globalAlpha, the `source-over`, `multiply` and
 * `lighter` blend modes, a rectangular clip, createImageData / putImageData.
 * Text, arcs and strokes are accepted and ignored. Used to compare frames
 * pixel by pixel across refactors and to read pixels back in regression tests.
 */

type Style = { fill: string; alpha: number; op: string; clip: [number, number, number, number] | undefined }

function parseColour(css: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(css)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
  throw new Error(`softCanvas: unsupported colour ${css}`)
}

export class SoftContext {
  fillStyle = '#000000'
  strokeStyle = '#000000'
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  imageSmoothingEnabled = true
  font = ''
  textAlign = 'left'
  textBaseline = 'alphabetic'
  lineWidth = 1
  private clipBox: [number, number, number, number] | undefined
  private path: [number, number, number, number] | undefined
  private readonly stack: Style[] = []
  /** Number of draw calls since the last reset (fillRect and drawImage). */
  calls = { fillRect: 0, drawImage: 0 }

  private readonly canvas: SoftCanvas

  constructor(canvas: SoftCanvas) {
    this.canvas = canvas
  }

  private blend(i: number, r: number, g: number, b: number, a: number): void {
    const d = this.canvas.data
    if (a <= 0) return
    const da = (d[i + 3] ?? 0) / 255
    const dr = d[i] ?? 0
    const dg = d[i + 1] ?? 0
    const db = d[i + 2] ?? 0
    if (this.globalCompositeOperation === 'lighter') {
      d[i] = Math.min(255, Math.round(dr * da + r * a))
      d[i + 1] = Math.min(255, Math.round(dg * da + g * a))
      d[i + 2] = Math.min(255, Math.round(db * da + b * a))
      d[i + 3] = Math.round(Math.min(1, da + a) * 255)
      return
    }
    let sr = r
    let sg = g
    let sb = b
    if (this.globalCompositeOperation === 'multiply') {
      sr = (r * dr) / 255
      sg = (g * dg) / 255
      sb = (b * db) / 255
      // Blend of the product with the source, weighted by backdrop alpha.
      sr = r * (1 - da) + sr * da
      sg = g * (1 - da) + sg * da
      sb = b * (1 - da) + sb * da
    }
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    d[i] = Math.round((sr * a + dr * da * (1 - a)) / oa)
    d[i + 1] = Math.round((sg * a + dg * da * (1 - a)) / oa)
    d[i + 2] = Math.round((sb * a + db * da * (1 - a)) / oa)
    d[i + 3] = Math.round(oa * 255)
  }

  private bounds(x: number, y: number, w: number, h: number): [number, number, number, number] {
    let x0 = Math.max(0, x)
    let y0 = Math.max(0, y)
    let x1 = Math.min(this.canvas.width, x + w)
    let y1 = Math.min(this.canvas.height, y + h)
    if (this.clipBox) {
      x0 = Math.max(x0, this.clipBox[0])
      y0 = Math.max(y0, this.clipBox[1])
      x1 = Math.min(x1, this.clipBox[2])
      y1 = Math.min(y1, this.clipBox[3])
    }
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)]
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.fillRect++
    // Rectangles are snapped to whole pixels the way an aliased canvas does for integer arguments.
    const rx = Math.round(x)
    const ry = Math.round(y)
    const [x0, y0, x1, y1] = this.bounds(rx, ry, Math.round(x + w) - rx, Math.round(y + h) - ry)
    const [r, g, b, ca] = parseColour(this.fillStyle)
    const a = ca * this.globalAlpha
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend((yy * this.canvas.width + xx) * 4, r, g, b, a)
  }

  drawImage(img: SoftCanvas, ...args: number[]): void {
    this.calls.drawImage++
    let sx = 0
    let sy = 0
    let sw = img.width
    let sh = img.height
    let dx: number
    let dy: number
    let dw: number
    let dh: number
    if (args.length === 2) [dx, dy, dw, dh] = [args[0]!, args[1]!, img.width, img.height]
    else if (args.length === 4) [dx, dy, dw, dh] = args as [number, number, number, number]
    else [sx, sy, sw, sh, dx, dy, dw, dh] = args as [number, number, number, number, number, number, number, number]
    if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0 || img.width === 0) return
    const [x0, y0, x1, y1] = this.bounds(dx, dy, dw, dh)
    for (let yy = y0; yy < y1; yy++) {
      const py = Math.min(img.height - 1, Math.max(0, Math.floor(sy + ((yy + 0.5 - dy) * sh) / dh)))
      for (let xx = x0; xx < x1; xx++) {
        const px = Math.min(img.width - 1, Math.max(0, Math.floor(sx + ((xx + 0.5 - dx) * sw) / dw)))
        const si = (py * img.width + px) * 4
        const sa = ((img.data[si + 3] ?? 0) / 255) * this.globalAlpha
        if (sa > 0) this.blend((yy * this.canvas.width + xx) * 4, img.data[si] ?? 0, img.data[si + 1] ?? 0, img.data[si + 2] ?? 0, sa)
      }
    }
  }

  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
  }

  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void {
    for (let yy = 0; yy < image.height; yy++)
      for (let xx = 0; xx < image.width; xx++) {
        const cx = x + xx
        const cy = y + yy
        if (cx < 0 || cy < 0 || cx >= this.canvas.width || cy >= this.canvas.height) continue
        for (let k = 0; k < 4; k++) this.canvas.data[(cy * this.canvas.width + cx) * 4 + k] = image.data[(yy * image.width + xx) * 4 + k] ?? 0
      }
  }

  save(): void {
    this.stack.push({ fill: this.fillStyle, alpha: this.globalAlpha, op: this.globalCompositeOperation, clip: this.clipBox })
  }

  restore(): void {
    const s = this.stack.pop()
    if (!s) return
    this.fillStyle = s.fill
    this.globalAlpha = s.alpha
    this.globalCompositeOperation = s.op
    this.clipBox = s.clip
  }

  beginPath(): void {
    this.path = undefined
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path = [x, y, x + w, y + h]
  }

  clip(): void {
    if (!this.path) return
    const [a, b, c, d] = this.path
    const prev = this.clipBox
    this.clipBox = prev ? [Math.max(a, prev[0]), Math.max(b, prev[1]), Math.min(c, prev[2]), Math.min(d, prev[3])] : [a, b, c, d]
  }

  setTransform(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}
  fillText(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 8 }
  }
}

export class SoftCanvas {
  data: Uint8ClampedArray
  private w: number
  private h: number
  private readonly ctx: SoftContext
  clientWidth = 0
  clientHeight = 0

  constructor(width = 300, height = 150) {
    this.w = width
    this.h = height
    this.data = new Uint8ClampedArray(width * height * 4)
    this.ctx = new SoftContext(this)
  }

  get width(): number {
    return this.w
  }

  set width(v: number) {
    this.w = v
    this.data = new Uint8ClampedArray(this.w * this.h * 4)
  }

  get height(): number {
    return this.h
  }

  set height(v: number) {
    this.h = v
    this.data = new Uint8ClampedArray(this.w * this.h * 4)
  }

  getContext(): SoftContext {
    return this.ctx
  }

  /** `#rrggbbaa` of one pixel. */
  pixel(x: number, y: number): string {
    const i = (y * this.w + x) * 4
    return '#' + [0, 1, 2, 3].map((k) => (this.data[i + k] ?? 0).toString(16).padStart(2, '0')).join('')
  }

  /** FNV-1a hash of the pixels (a compact fingerprint of a frame). */
  hash(): string {
    let h = 0x811c9dc5
    for (let i = 0; i < this.data.length; i++) h = Math.imul(h ^ (this.data[i] ?? 0), 0x01000193) >>> 0
    return `${this.w}x${this.h}:${h.toString(16).padStart(8, '0')}`
  }
}

/**
 * Make `document.createElement('canvas')` return software canvases for the
 * duration of a test; returns the restore function.
 */
export function installSoftCanvas(): () => void {
  const real = document.createElement.bind(document)
  document.createElement = ((tag: string, ...rest: unknown[]) => (tag === 'canvas' ? new SoftCanvas() : real(tag, ...(rest as []))) as never) as typeof document.createElement
  return () => {
    document.createElement = real as typeof document.createElement
  }
}
