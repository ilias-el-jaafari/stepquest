import type { Locale } from './locale.ts'

/** Whole or fractional number in the locale's separators ("10.000" in Spanish, "10,000" in English). */
export function formatNumber(value: number, locale: Locale): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString(locale)
}

/** Fixed number of decimals with the locale's decimal separator; never "NaN" or "-0". */
export function formatDecimal(value: number, locale: Locale, digits: number): string {
  const safe = Number.isFinite(value) ? value : 0
  const text = safe.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
  // A tiny negative rounds to "-0,0"; show it as zero.
  return /^-0(?:[.,]0*)?$/.test(text) ? text.slice(1) : text
}

/** Kilometres with two decimals, e.g. "7,50 km". The unit symbol is the same in both languages. */
export function formatKm(metres: number, locale: Locale): string {
  return `${formatDecimal(metres / 1000, locale, 2)} km`
}

/** Metres below one kilometre, kilometres from there on ("480 m", "1,25 km"). */
export function formatDistance(metres: number, locale: Locale): string {
  const m = Number.isFinite(metres) ? metres : 0
  return Math.round(m) < 1000 ? `${Math.round(m)} m` : formatKm(m, locale)
}

/** Sign and magnitude of a ratio as percent with one decimal, for "{sign}{pct}%". */
export function formatSignedPercent(ratio: number, locale: Locale): { sign: '+' | '−'; pct: string } {
  const pct = formatDecimal(Math.abs(ratio) * 100, locale, 1)
  return { sign: ratio < 0 && pct !== formatDecimal(0, locale, 1) ? '−' : '+', pct }
}
