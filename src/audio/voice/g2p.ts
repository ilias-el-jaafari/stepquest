import type { Locale } from '../../i18n/locale.ts'
import { isPhonemeSymbol, PHONEMES, type Phone, type PhonemeSymbol } from './phonemes.ts'

/**
 * Text → phonemes. Spanish spelling is regular, so it is converted by rules
 * (Castilian: c/z as "th"). English uses a small pronouncing dictionary that
 * covers every word the app says, with simple letter rules as a fallback.
 * Stress is marked with "1" after a vowel.
 */
export const EN_LEXICON: Record<string, string> = {
  a: 'AX', and: 'AE1 N D', away: 'AX W EY1', back: 'B AE K', check: 'T SH EH K', complete: 'K AX M P L IY1 T', done: 'D AH N',
  far: 'F AA R', first: 'F ER S T', flag: 'F L AE G', for: 'F AO R', gem: 'D ZH EH M', gems: 'D ZH EH M Z', halfway: 'HH AE1 F W EY',
  head: 'HH EH D', in: 'IH N', is: 'IH Z', left: 'L EH F T', meter: 'M IY1 T ER', meters: 'M IY1 T ER Z', next: 'N EH K S T', now: 'N AW',
  of: 'AH V', off: 'AO F', on: 'AA N', quest: 'K W EH S T', right: 'R AY T', route: 'R UW T', so: 'S OW', sound: 'S AW N D',
  started: 'S T AA1 R T IH D', step: 'S T EH P', steps: 'S T EH P S', the: 'DH AX', there: 'DH EH R', to: 'T UW', turn: 'T ER N',
  well: 'W EH L', north: 'N AO R TH', east: 'IY S T', south: 'S AW TH', west: 'W EH S T', minus: 'M AY1 N AX S',
  zero: 'Z IY1 R OW', one: 'W AH N', two: 'T UW', three: 'TH R IY', four: 'F AO R', five: 'F AY V', six: 'S IH K S', seven: 'S EH1 V AX N',
  eight: 'EY T', nine: 'N AY N', ten: 'T EH N', eleven: 'IH L EH1 V AX N', twelve: 'T W EH L V', thirteen: 'TH ER T IY1 N',
  fourteen: 'F AO R T IY1 N', fifteen: 'F IH F T IY1 N', sixteen: 'S IH K S T IY1 N', seventeen: 'S EH V AX N T IY1 N', eighteen: 'EY T IY1 N',
  nineteen: 'N AY N T IY1 N', twenty: 'T W EH1 N T IY', thirty: 'TH ER1 T IY', forty: 'F AO1 R T IY', fifty: 'F IH1 F T IY', sixty: 'S IH1 K S T IY',
  seventy: 'S EH1 V AX N T IY', eighty: 'EY1 T IY', ninety: 'N AY1 N T IY', hundred: 'HH AH1 N D R AX D', thousand: 'TH AW1 Z AX N D',
  million: 'M IH1 L Y AX N', point: 'P OY1 N T', percent: 'P ER S EH1 N T', kilometer: 'K IH L AA1 M AX T ER', kilometers: 'K IH L AA1 M AX T ER Z',
  minute: 'M IH1 N AX T', minutes: 'M IH1 N AX T S', hour: 'AW1 ER', hours: 'AW1 ER Z', second: 'S EH1 K AX N D', seconds: 'S EH1 K AX N D Z',
}

const VOWEL_KINDS = new Set(['vowel'])
const isVowel = (p: PhonemeSymbol) => VOWEL_KINDS.has(PHONEMES[p].kind)

/** Parse "K W EH1 S T" into phones; a single-vowel word gets the stress. */
export function parsePron(pron: string): Phone[] {
  const phones: Phone[] = []
  for (const tok of pron.trim().split(/\s+/)) {
    const stress = tok.endsWith('1')
    const sym = stress ? tok.slice(0, -1) : tok
    if (!isPhonemeSymbol(sym)) throw new Error(`Unknown phoneme ${sym}`)
    phones.push(stress ? { p: sym, stress: true } : { p: sym })
  }
  if (!phones.some((p) => p.stress)) {
    const first = phones.find((p) => isVowel(p.p))
    if (first) first.stress = true
  }
  return phones
}

/** Naive English letter rules, only for words missing from the dictionary. */
const EN_RULES: [RegExp, string][] = [
  [/^tion/, 'SH AX N'], [/^th/, 'TH'], [/^sh/, 'SH'], [/^ch/, 'T SH'], [/^ph/, 'F'], [/^ck/, 'K'], [/^ng/, 'NG'], [/^qu/, 'K W'],
  [/^ee/, 'IY'], [/^ea/, 'IY'], [/^oo/, 'UW'], [/^ou/, 'AW'], [/^ow/, 'OW'], [/^ai/, 'EY'], [/^ay/, 'EY'], [/^oi/, 'OY'], [/^igh/, 'AY'],
  [/^a/, 'AE'], [/^e/, 'EH'], [/^i/, 'IH'], [/^o/, 'AA'], [/^u/, 'AH'], [/^y(?=[aeiou])/, 'Y'], [/^y/, 'IY'],
  [/^b/, 'B'], [/^c(?=[eiy])/, 'S'], [/^c/, 'K'], [/^d/, 'D'], [/^f/, 'F'], [/^g/, 'G'], [/^h/, 'HH'], [/^j/, 'D ZH'], [/^k/, 'K'],
  [/^l/, 'L'], [/^m/, 'M'], [/^n/, 'N'], [/^p/, 'P'], [/^r/, 'R'], [/^s/, 'S'], [/^t/, 'T'], [/^v/, 'V'], [/^w/, 'W'], [/^x/, 'K S'], [/^z/, 'Z'],
]

export function englishWord(word: string): Phone[] {
  // Accented letters read as their base letter (café → cafe).
  const w = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]/g, '')
  const known = Object.hasOwn(EN_LEXICON, w) ? EN_LEXICON[w] : undefined
  if (known) return parsePron(known)
  // Silent final e (but not in "the", "be").
  let rest = w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w
  const out: string[] = []
  while (rest) {
    const rule = EN_RULES.find(([re]) => re.test(rest))
    if (!rule) {
      rest = rest.slice(1)
      continue
    }
    const m = rest.match(rule[0])!
    out.push(rule[1])
    rest = rest.slice(m[0].length || 1)
  }
  return out.length ? parsePron(out.join(' ')) : []
}

const ES_STRONG = new Set(['a', 'e', 'o', 'á', 'é', 'í', 'ó', 'ú'])
const ES_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü'])
const ES_VOWEL_PH: Record<string, PhonemeSymbol> = { a: 'A', á: 'A', e: 'E', é: 'E', i: 'I', í: 'I', o: 'O', ó: 'O', u: 'U', ú: 'U', ü: 'U' }

/** Index (into the word) of the vowel that carries the stress. */
export function spanishStress(word: string): number {
  const accented = word.search(/[áéíóú]/)
  if (accented >= 0) return accented
  // Vowel groups (a diphthong is one syllable nucleus).
  const groups: number[][] = []
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!
    if (!ES_VOWELS.has(c)) continue
    // "qu"/"gu" + e/i: the u is silent, not a vowel.
    if (c === 'u' && (word[i - 1] === 'q' || word[i - 1] === 'g') && (word[i + 1] === 'e' || word[i + 1] === 'i')) continue
    const prev = groups[groups.length - 1]
    const prevIdx = prev?.[prev.length - 1]
    const bothStrong = prevIdx !== undefined && ES_STRONG.has(word[prevIdx]!) && ES_STRONG.has(c)
    if (prev && prevIdx === i - 1 && !bothStrong) prev.push(i)
    else groups.push([i])
  }
  if (!groups.length) return -1
  const last = word[word.length - 1]!
  const penult = ES_VOWELS.has(last) || last === 'n' || last === 's'
  const g = groups[penult && groups.length > 1 ? groups.length - 2 : groups.length - 1]!
  // In a diphthong the strong vowel (a, e, o) takes the stress; with two weak ones, the second.
  return g.find((i) => ES_STRONG.has(word[i]!)) ?? g[g.length - 1]!
}

/** Lower-case NFC word keeping only Spanish letters; other accents fall back to the base letter (ç → c, à → a). */
function foldSpanish(raw: string): string {
  let out = ''
  for (const ch of raw.toLowerCase().normalize('NFC')) {
    if (/[a-záéíóúüñ]/.test(ch)) out += ch
    else out += ch.normalize('NFD').replace(/[^a-z]/g, '')
  }
  return out
}

export function spanishWord(raw: string): Phone[] {
  const w = foldSpanish(raw)
  const stressAt = spanishStress(w)
  const out: Phone[] = []
  const push = (p: PhonemeSymbol, extra: Partial<Phone> = {}) => out.push({ p, ...extra })
  for (let i = 0; i < w.length; i++) {
    const c = w[i]!
    const next = w[i + 1] ?? ''
    const prev = w[i - 1] ?? ''
    const frontNext = next === 'e' || next === 'i' || next === 'é' || next === 'í'
    if (ES_VOWELS.has(c)) {
      const ph = ES_VOWEL_PH[c]!
      const weak = c === 'i' || c === 'u' || c === 'ü'
      const nearVowel = ES_VOWELS.has(prev) || ES_VOWELS.has(next)
      if (i === stressAt) push(ph, { stress: true, len: 1.3 })
      else if (weak && nearVowel) push(c === 'i' ? 'Y' : 'W', { len: 0.7 })
      else push(ph)
      continue
    }
    switch (c) {
      case 'c':
        if (next === 'h') {
          push('T', { len: 0.5 })
          push('SH', { len: 0.6 })
          i++
        } else push(frontNext ? 'TH' : 'K')
        break
      case 'q':
        push('K')
        if (next === 'u') i++
        break
      case 'g':
        if (frontNext) push('X')
        else {
          push('G', { len: 0.8 })
          if (next === 'u' && (w[i + 2] === 'e' || w[i + 2] === 'i' || w[i + 2] === 'é' || w[i + 2] === 'í')) i++
        }
        break
      case 'l':
        if (next === 'l') {
          push('Y')
          i++
        } else push('L')
        break
      case 'r':
        if (next === 'r') {
          push('RR')
          i++
        } else push(i === 0 || prev === 'n' || prev === 'l' || prev === 's' ? 'RR' : 'RX')
        break
      case 'y':
        push(ES_VOWELS.has(next) ? 'Y' : 'I')
        break
      case 'h':
        break
      case 'ñ':
        push('NY')
        break
      case 'j':
        push('X')
        break
      case 'z':
        push('TH')
        break
      case 'v':
      case 'b':
        push('B', { len: 0.8 })
        break
      case 'x':
        push('K', { len: 0.7 })
        push('S')
        break
      case 'd':
        push('D', { len: i === w.length - 1 ? 0.4 : 0.8 })
        break
      case 'w':
        push('W')
        break
      default: {
        const up = c.toUpperCase()
        if (isPhonemeSymbol(up)) push(up)
      }
    }
  }
  return out
}

/** Push a pause unless one is already there: repeated punctuation gives one pause, the longest. */
function pushPause(out: Phone[], p: ',' | '.') {
  const last = out[out.length - 1]
  if (!last) return
  if (last.p === '.') return
  if (last.p === ',') {
    if (p === '.') last.p = '.'
    return
  }
  out.push({ p })
}

/** A whole phrase as phones, with word gaps and pauses at punctuation. */
export function textToPhones(text: string, locale: Locale): Phone[] {
  const out: Phone[] = []
  const tokens = text.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}']+|[.!?;:,]/gu) ?? []
  for (const tok of tokens) {
    if (/^[.!?]$/.test(tok)) {
      pushPause(out, '.')
      continue
    }
    if (/^[,;:]$/.test(tok)) {
      pushPause(out, ',')
      continue
    }
    const phones = locale === 'es' ? spanishWord(tok) : englishWord(tok)
    if (!phones.length) continue
    const last = out[out.length - 1]
    if (last && last.p !== '.' && last.p !== ',') out.push({ p: '_' })
    out.push(...phones)
  }
  // Drop trailing pauses.
  while (out.length && PHONEMES[out[out.length - 1]!.p].kind === 'pause') out.pop()
  return out
}

/** Every word in the text that the English dictionary does not know (for tests). */
export function unknownEnglishWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !Object.hasOwn(EN_LEXICON, w.replace(/[^a-z]/g, '')))
}
