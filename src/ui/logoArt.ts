import type { Icon } from './pixelArt.ts'

/**
 * The logo mark: a faceted gem standing on a winding path (original design).
 * 16×16, one letter per pixel: k = outline, h = light facet, y = gold, o = dark facet,
 * s = sand path, . = transparent.
 */
export const LOGO: Icon = {
  rows: [
    '................',
    '....kkkkkkkk....',
    '...khhyyyyyok...',
    '..khhyyyyyyook..',
    '.khhyyyyyyyyook.',
    '.kkkkkkkkkkkkkk.',
    '..khyyyyyyyyok..',
    '...kyyyyyyyok...',
    '....kyyyyyyk....',
    '.....kyyyyk.....',
    '......kyyk......',
    '.......kk.......',
    '......ssss......',
    '.....ssssss.....',
    '....ssssssss....',
    '...ssssssssss...',
  ],
  colors: { k: '#1b1a2e', h: '#fff3a8', y: '#ffd84a', o: '#c99a10', s: '#ecc98f' },
}

/** Background of the favicon and app icons (the map grass). */
export const LOGO_BACKGROUND = '#74c45a'

/** The logo as an SVG document: grass tile plus one rect per run of equal pixels. */
export function logoSvg(): string {
  const rects = [`<rect width="16" height="16" fill="${LOGO_BACKGROUND}"/>`]
  LOGO.rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x] ?? '.'
      let w = 1
      while (row[x + w] === ch) w++
      const c = LOGO.colors[ch]
      if (c) rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`)
      x += w
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">\n  ${rects.join('\n  ')}\n</svg>\n`
}
