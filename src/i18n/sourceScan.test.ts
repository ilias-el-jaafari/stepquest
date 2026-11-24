import { parseAst } from 'rolldown/parseAst'
import { describe, expect, it } from 'vitest'

/**
 * Source scan for the i18n rules in requirements 8.9 to 8.12 (retro-ui): no user-facing
 * text typed into JSX or accessibility attributes, and no number formatting that ignores
 * the language. The parser is `rolldown/parseAst` (ESTree), a pinned devDependency (`~1.2`, the line Vite 8 uses; TypeScript 7 has no JS parser API).
 */
const raw = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.*', '!../i18n/**', '!../**/testing/**'], { query: '?raw', import: 'default', eager: true })
/** Source files by path relative to `src/` (the `../` prefix of the glob removed). */
const sources = Object.entries(raw).map(([path, code]) => ({ file: path.replace(/^\.\.\//, ''), code }))

const TEXT_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'title', 'alt', 'placeholder', 'label'])
const HAS_WORD = /\p{L}{2,}/u

/**
 * Allowed literals. Language names are shown in their own language on purpose (a visitor
 * who cannot read the current language must still find theirs).
 */
export const LITERAL_ALLOWLIST = new Set(['Español', 'English'])

export type Finding = { file: string; line: number; text: string }

type Node = { type: string; start: number; [key: string]: unknown }
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'

/** Strings a node can evaluate to when it is a literal, a template, or a choice between them. */
function literalTexts(node: unknown): { start: number; text: string }[] {
  if (!isNode(node)) return []
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [{ start: node.start, text: node.value }] : []
    case 'TemplateLiteral':
      return [{ start: node.start, text: (node.quasis as { value: { cooked: string } }[]).map((q) => q.value.cooked).join(' ') }]
    case 'ConditionalExpression':
      return [...literalTexts(node.consequent), ...literalTexts(node.alternate)]
    case 'LogicalExpression':
      return [...literalTexts(node.left), ...literalTexts(node.right)]
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return literalTexts(node.expression)
    default:
      return []
  }
}

export function findHardCodedText(file: string, code: string): Finding[] {
  const ast = parseAst(code, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' })
  const found: Finding[] = []
  const add = (start: number, text: string) => {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (!HAS_WORD.test(trimmed) || LITERAL_ALLOWLIST.has(trimmed)) return
    found.push({ file, line: code.slice(0, start).split('\n').length, text: trimmed })
  }
  const visit = (node: unknown, parent?: Node) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, parent))
    if (!isNode(node)) return
    if (node.type === 'JSXText') add(node.start, String(node.value))
    else if (node.type === 'JSXAttribute') {
      const name = (node.name as { name?: string }).name ?? ''
      const value = node.value as Node | null
      if (TEXT_ATTRIBUTES.has(name)) {
        const parts = value?.type === 'JSXExpressionContainer' ? literalTexts(value.expression) : literalTexts(value)
        for (const p of parts) add(p.start, p.text)
      }
    } else if (node.type === 'JSXExpressionContainer' && parent?.type !== 'JSXAttribute') {
      for (const p of literalTexts(node.expression)) add(p.start, p.text)
    } else if (node.type === 'AssignmentExpression') {
      const left = node.left as { type: string; object?: { name?: string }; property?: { name?: string } }
      if (left.type === 'MemberExpression' && left.object?.name === 'document' && left.property?.name === 'title') {
        for (const p of literalTexts(node.right)) add(p.start, p.text)
      }
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'parent' && typeof child === 'object') visit(child, node)
  }
  visit(ast)
  return found
}

describe('source scan: no hard-coded user-facing text', () => {

  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(30)
  })

  it('has no text typed into JSX, accessibility attributes or document.title outside src/i18n', () => {
    const findings = sources.flatMap(({ file, code }) => findHardCodedText(file, code))
    expect(findings.map((f) => `${f.file}:${f.line} "${f.text}"`)).toEqual([])
  })

  it('detects the patterns it is meant to catch (scanner self-test)', () => {
    const bad = `
      export const A = () => <button aria-label="Close">Close</button>
      export const B = () => <img alt={'A gem'} title={\`Gem \${1}\`} />
      export const C = () => <p>{'Hello there'}</p>
      document.title = 'Hi there'
    `
    const hits = findHardCodedText('x.tsx', bad).map((f) => f.text)
    expect(hits).toEqual(['Close', 'Close', 'A gem', 'Gem', 'Hello there', 'Hi there'])
    const good = `export const A = () => <button aria-label={t('a')}>{t('b')} → {n}</button>`
    expect(findHardCodedText('y.tsx', good)).toEqual([])
    expect(findHardCodedText('z.tsx', `export const A = () => <option value="es">Español</option>`)).toEqual([])
  })
})

describe('source scan: numbers follow the language', () => {
  /** Files allowed to print a number with `toFixed`, and why. */
  const TO_FIXED_ALLOWED: Record<string, string> = {
    'geo/coords.ts': 'coordinates are typed and parsed with a point (data.badCoords shows the format)',
    'osm/overpass.ts': 'bounding box in the query string',
    'osm/demoArea.ts': 'bounding box in the query string',
  }

  it('does not print numbers for people with toFixed or an argument-less toLocaleString', () => {
    const offenders: string[] = []
    for (const { file: rel, code } of sources) {
      code.split('\n').forEach((line, i) => {
        if (/\.toLocaleString\(\s*\)/.test(line)) offenders.push(`${rel}:${i + 1} toLocaleString() without a locale`)
        if (/\.toFixed\(/.test(line) && !TO_FIXED_ALLOWED[rel]) offenders.push(`${rel}:${i + 1} toFixed (use i18n/format.ts)`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('keeps the unit "km" out of JSX (it belongs to the formatted value)', () => {
    const offenders = sources
      .filter(({ file }) => file.endsWith('.tsx'))
      .flatMap(({ file, code }) => code.split('\n').map((line, i) => ({ file, line, i })))
      .filter(({ line }) => /\}\s*km\b/.test(line) && !/t\(/.test(line))
      .map(({ file, i }) => `${file}:${i + 1}`)
    expect(offenders).toEqual([])
  })
})
