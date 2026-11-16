// The palette guard (docs/identity.md). src/index.css resets Tailwind's stock
// palette (--color-*: initial), and Tailwind drops a class whose colour no
// longer exists without a word: bg-amber-600 would simply draw nothing. So this
// fails on a stock hue class anywhere in src, and on a raw hex colour outside
// src/index.css, where Hurra's colours live.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const THIS_FILE = 'lib/tokens.test.ts'

/** Tailwind's stock hues (node_modules/tailwindcss/theme.css), all gone since the reset. */
const STOCK_HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe',
]
const SHADE = '(?:50|[1-9]00|950)'

/**
 * A stock hue with a shade: after a utility's dash, with any variants and an
 * opacity (bg-amber-600, hover:ring-slate-300/80, from-sky-500/30), in a CSS
 * variable (var(--color-amber-600)) or theme(colors.amber.600), and a hue
 * spliced into a class name (bg-${hue}-500). Hurra's own names never match:
 * bg-pink, text-key-c, bg-guest-teal, bg-paper-2.
 */
const STOCK_CLASS = new RegExp(`(?<=[-.])(?:${STOCK_HUES.join('|')})[-.]${SHADE}(?!\\w)|-\\$\\{[^}]*\\}-${SHADE}(?!\\w)`, 'g')

/** A CSS hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa), not an anchor like #add-a-game or an entity like &#123;. */
const HEX = /(?<![\w&#])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi

/** Files that may hold raw hex colours, each with its reason. Keep it short. */
const HEX_ALLOWED: Record<string, string> = {
  'index.css': "Hurra's colours are defined here",
  'lib/media.ts': 'a canvas fill for the transparent parts of uploaded pictures: a canvas cannot read CSS variables',
  'components/host/recapView.ts': "the recap race chart's validated categorical palette, one line per guest, not identity colours",
  [THIS_FILE]: "this guard's own examples",
}

/** Every text file under src, by its path from src with forward slashes. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|css|html|svg|json)$/.test(entry.name) ? [relative(SRC, path).split(sep).join('/')] : []
  })
}

/** Each match of `pattern` in `file`, as "file:line: match". */
function findings(file: string, pattern: RegExp): string[] {
  return readFileSync(join(SRC, file), 'utf8')
    .split('\n')
    .flatMap((line, i) => Array.from(line.matchAll(pattern), (match) => `src/${file}:${i + 1}: ${match[0]}`))
}

const matches = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), (match) => match[0])

describe('the palette guard', () => {
  it('knows a stock Tailwind colour from a Hurra token', () => {
    const stock = [
      'bg-amber-600',
      'ring-slate-300/80',
      'hover:text-slate-200',
      'md:hover:bg-emerald-500/[0.35]',
      'from-sky-500/30',
      'border-x-zinc-900',
      'inset-ring-mist-100',
      'decoration-taupe-950',
      'text-gray-50!',
      'shadow-[0_0_4px_var(--color-rose-400)]',
      'bg-[theme(colors.indigo.700)]',
      'bg-${hue}-500',
      "['bg-primary', 'bg-red-400'][i]",
    ]
    for (const name of stock) expect(matches(name, STOCK_CLASS), name).toHaveLength(1)

    const tokens = [
      'bg-pink',
      'text-pink/80',
      'bg-guest-teal',
      'bg-guest-violet/40',
      'text-key-c',
      'bg-key-d',
      'bg-paper-2',
      'text-paper-3',
      'ring-confetti-violet',
      'bg-gold-rim',
      'text-tv-floor',
      'size-500',
      'primrose-100',
    ]
    for (const name of tokens) expect(matches(name, STOCK_CLASS), name).toEqual([])
  })

  it('knows a hex colour from an anchor or an issue number', () => {
    for (const hex of ['#fff', '#14110E', "'#ff6fae'", 'bg-[#06050b]', '#0008', 'fill="#b7791f80"']) {
      expect(matches(hex, HEX), hex).toHaveLength(1)
    }
    for (const text of ['#add-a-game', 'issue #12', '&#123;', '#abcde', '#1234567', '#coffee']) {
      expect(matches(text, HEX), text).toEqual([])
    }
  })

  it("names every hue in Tailwind's own palette", () => {
    const theme = readFileSync(new URL('../../node_modules/tailwindcss/theme.css', import.meta.url), 'utf8')
    const hues = new Set(Array.from(theme.matchAll(/--color-([a-z]+)-50:/g), (match) => match[1]))
    expect([...hues].sort()).toEqual([...STOCK_HUES].sort())
  })
})

describe("src uses only Hurra's colours", () => {
  const files = sourceFiles()

  it('has no stock Tailwind colour class, variable or theme() call', () => {
    expect(files.filter((file) => file !== THIS_FILE).flatMap((file) => findings(file, STOCK_CLASS))).toEqual([])
  })

  it('has no raw hex colour outside src/index.css and the allowed files', () => {
    expect(files.filter((file) => !(file in HEX_ALLOWED)).flatMap((file) => findings(file, HEX))).toEqual([])
  })

  it('keeps only exceptions that are still needed', () => {
    for (const file of Object.keys(HEX_ALLOWED)) {
      expect(files, file).toContain(file)
      expect(findings(file, HEX).length, `${file} holds no hex colour any more: drop it from HEX_ALLOWED`).toBeGreaterThan(0)
    }
  })
})
