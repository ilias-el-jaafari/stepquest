/** The phrase on air: shown as a speech bubble next to the walker while it lasts. */
export type SpokenPhrase = { id: number; text: string }

/** How long a phrase stays visible when nothing is spoken (muted, locked or suspended audio). */
export function bubbleDurationMs(text: string): number {
  return Math.min(7000, Math.max(1800, 1000 + text.length * 70))
}

/** Greedy word wrap for the bubble (monospace pixel font); long words are split. Never drops text. */
export function wrapBubbleText(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let line = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > maxChars) {
      if (line) lines.push(line)
      lines.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
      line = ''
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}
