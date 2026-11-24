/** The phrase on air: shown as a speech bubble next to the walker while it lasts. */
export type SpokenPhrase = { id: number; text: string }

/** How long a phrase stays visible when nothing is spoken (muted, locked or suspended audio). */
export function bubbleDurationMs(text: string): number {
  return Math.min(7000, Math.max(1800, 1000 + text.length * 70))
}

/**
 * Greedy word wrap for the bubble (monospace pixel font); long words are split.
 * Never drops text and always terminates: a width below 1 is treated as 1, and
 * characters outside the basic plane (emoji) count as one and are never cut in half.
 */
export function wrapBubbleText(text: string, maxChars: number): string[] {
  const width = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : 1
  const lines: string[] = []
  let line: string[] = []
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let chars = Array.from(word)
    while (chars.length > width) {
      if (line.length) lines.push(line.join(''))
      lines.push(chars.slice(0, width).join(''))
      chars = chars.slice(width)
      line = []
    }
    if (!line.length) line = chars
    else if (line.length + 1 + chars.length <= width) line = [...line, ' ', ...chars]
    else {
      lines.push(line.join(''))
      line = chars
    }
  }
  if (line.length) lines.push(line.join(''))
  return lines
}
