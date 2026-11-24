import type { Locale } from '../../i18n/locale.ts'
import { spellNumbersInText } from './numbers.ts'

/**
 * Text pipeline, first stage: from a phrase as written (i18n output) to text a
 * letter-to-sound converter can read. Pure.
 *
 *   limitSpokenText → normalizeSpeech (NFC, numbers, decimals, units) → textToPhones (g2p.ts) → renderPhones (synth.ts)
 */

/** A spoken phrase is cut at this many characters (the app's longest callout is about 100). */
export const MAX_SPOKEN_CHARS = 280

/**
 * Trim a phrase and, when it is longer than `max` characters, cut it at the last
 * sentence end, else the last space, else hard. The engine queues this shortened
 * text, so the speech bubble shows exactly what is spoken.
 */
export function limitSpokenText(text: string, max = MAX_SPOKEN_CHARS): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  if (chars.length <= max) return chars.join('')
  const head = chars.slice(0, max).join('')
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentence > max * 0.3) return head.slice(0, sentence + 1)
  const space = head.lastIndexOf(' ')
  return (space > max * 0.3 ? head.slice(0, space) : head).trim()
}

/** Composed accents, numbers and units in words; everything else unchanged. */
export function normalizeSpeech(text: string, locale: Locale): string {
  return spellNumbersInText(text.normalize('NFC'), locale)
}
