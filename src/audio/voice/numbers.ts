import type { Locale } from '../../i18n/locale.ts'

const EN_SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function enBelow1000(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(`${EN_SMALL[h]} hundred`)
  if (r || !h) {
    if (r < 20) parts.push(EN_SMALL[r]!)
    else parts.push(EN_TENS[Math.floor(r / 10)]! + (r % 10 ? ` ${EN_SMALL[r % 10]}` : ''))
  }
  return parts.join(' ')
}

const ES_SMALL = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
]
const ES_TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const ES_HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function esBelow1000(n: number): string {
  if (n === 100) return 'cien'
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(ES_HUNDREDS[h]!)
  if (r || !h) {
    if (r < 30) parts.push(ES_SMALL[r]!)
    else parts.push(ES_TENS[Math.floor(r / 10)]! + (r % 10 ? ` y ${ES_SMALL[r % 10]}` : ''))
  }
  return parts.join(' ')
}

/** "uno" → "un" before a noun or "mil" (veintiún mil, treinta y un metros). */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, 'veintiún').replace(/\buno$/, 'un')
}

/**
 * A whole number in words (0 to 999,999,999). Spanish uses the short form
 * of "uno" when a noun follows (`beforeNoun`).
 */
export function spellNumber(n: number, locale: Locale, beforeNoun = false): string {
  const v = Math.round(Math.abs(n))
  const sign = n < 0 ? (locale === 'es' ? 'menos ' : 'minus ') : ''
  if (v >= 1e9) return sign + String(v)
  const millions = Math.floor(v / 1e6)
  const thousands = Math.floor((v % 1e6) / 1000)
  const rest = v % 1000
  const parts: string[] = []
  if (locale === 'es') {
    if (millions) parts.push(millions === 1 ? 'un millón' : `${apocope(esBelow1000(millions))} millones`)
    if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(esBelow1000(thousands))} mil`)
    if (rest || v === 0) parts.push(beforeNoun ? apocope(esBelow1000(rest)) : esBelow1000(rest))
  } else {
    if (millions) parts.push(`${enBelow1000(millions)} million`)
    if (thousands) parts.push(`${enBelow1000(thousands)} thousand`)
    if (rest || v === 0) parts.push(enBelow1000(rest))
  }
  return sign + parts.join(' ')
}

/** Masculine nouns that follow numbers in our phrases ("un metro", "veintiún pasos"). */
const MASCULINE_NOUN = /^\s+(metros?|pasos?|kil[oó]metros?|minutos?|segundos?)\b/i

/**
 * Text ready to speak: numbers become words (thousand separators allowed),
 * everything else is kept. In Spanish a number followed by a masculine noun gets
 * the short form ("un metro", "veintiún pasos").
 */
export function spellNumbersInText(text: string, locale: Locale): string {
  return text.replace(/\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+(?!\d)|\d+/g, (match, offset: number) => {
    const n = Number(match.replace(/[^\d]/g, ''))
    const after = text.slice(offset + match.length)
    const beforeNoun = locale === 'es' && MASCULINE_NOUN.test(after)
    return spellNumber(n, locale, beforeNoun)
  })
}
