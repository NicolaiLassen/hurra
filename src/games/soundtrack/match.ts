// Lydspor's matching rules (.design/lydspor/spec.md, section 5.2): how a typed
// title or singer is read, how many wrong letters it may have, and how the
// rule judges it against the accepted texts (the song's own, plus the extra
// answers from the settings). The game judges every answer once, at the lock,
// on the server; phones never normalise and never judge. The host's settings
// editor uses normalise, judge and typosAllowed for its warnings.
//
// Relative imports only: the Netlify function bundles this file.
import type { CloseReason, TypedPart, Verdict } from './types'

/**
 * One way a text may be read: its key, its words A to Z (for singers), and its
 * words. `numberWords` marks an accepted text read with its numbers spelled
 * out ("7 Years" as "seven years"): its key has no digits for the number
 * check, so a typed answer is only within its allowance when it says each of
 * those words (spelled right, or within the word's own allowance).
 */
export type Form = { key: string; sorted: string; words: string[]; numberWords?: string[] }

export type Judgement = { verdict: Verdict; reason: CloseReason | null; off: number | null }

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Joining words that never matter: "Ditte & Vincent" is "Ditte Vincent". */
const CONNECTORS = new Set(['and', 'og', 'n'])
/** Short words that are the same word: "Mister" is "Mr". */
const SAME_WORD: Readonly<Record<string, string>> = {
  mister: 'mr',
  missus: 'mrs',
  saint: 'st',
  sankt: 'st',
  doctor: 'dr',
  versus: 'vs',
}
const FEAT = new Set(['feat', 'ft', 'featuring'])

/** Letters that NFD doesn't take apart, spelled out the usual way. */
const LETTERS: readonly [RegExp, string][] = [
  [/æ/g, 'ae'],
  [/ø/g, 'oe'],
  [/å/g, 'aa'],
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ß/g, 'ss'],
  [/œ/g, 'oe'],
  [/[ðđ]/g, 'd'],
  [/þ/g, 'th'],
  [/ł/g, 'l'],
  [/ı/g, 'i'],
]

/** Danish spellings meet: å as aa or a, æ as ae or a, ø as oe or o. */
const fold = (key: string) => key.replace(/aa/g, 'a').replace(/ae/g, 'a').replace(/oe/g, 'o')

/** The words with English number words as digits ("twenty two", "twenty-two" and "twentytwo" are 22), or null when there are none. */
function asDigits(words: readonly string[]): string[] | null {
  let changed = false
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const one = ONES.indexOf(word)
    if (one >= 0) {
      out.push(String(one))
      changed = true
      continue
    }
    const teen = TEENS.indexOf(word)
    if (teen >= 0) {
      out.push(String(10 + teen))
      changed = true
      continue
    }
    const ten = TENS.indexOf(word)
    if (ten >= 2) {
      const next = ONES.indexOf(words[i + 1] ?? '')
      if (next >= 1) {
        out.push(String(ten * 10 + next))
        i++
      } else {
        out.push(String(ten * 10))
      }
      changed = true
      continue
    }
    const joined = TENS.findIndex((tens, k) => k >= 2 && word.startsWith(tens) && ONES.indexOf(word.slice(tens.length)) >= 1)
    if (joined >= 2) {
      out.push(String(joined * 10 + ONES.indexOf(word.slice(TENS[joined].length))))
      changed = true
      continue
    }
    out.push(word)
  }
  return changed ? out : null
}

/** The long word of each short one, for an accepted text: "Dr" is also read "Doctor". */
const LONG_WORD: Readonly<Record<string, string>> = { mr: 'mister', mrs: 'missus', st: 'saint', dr: 'doctor', vs: 'versus' }

/**
 * How words like Mister and Dr are read: `short` makes them the same word
 * (step 8, every text); an accepted text is also read with them `kept` as
 * written and `long`, so a typo in "Doctor" is one letter, not four.
 */
type SameWords = 'short' | 'kept' | 'long'

/** Every run of characters other than a to z and 0 to 9 splits words. */
const wordsOf = (text: string, same: SameWords = 'short') =>
  text
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => {
      if (same === 'kept') return word
      const short = SAME_WORD[word] ?? word
      return same === 'long' ? (LONG_WORD[short] ?? short) : short
    })

/** A feat. tail cut (the short form) or named feat (the full form), joining words dropped, a leading "the" dropped unless `keepThe`. */
function tidy(words: string[], cutFeat: boolean, keepThe = false): string[] {
  let out = words
  if (cutFeat) {
    const at = out.findIndex((word, i) => i > 0 && FEAT.has(word))
    if (at > 0) out = out.slice(0, at)
  } else {
    out = out.map((word) => (FEAT.has(word) ? 'feat' : word))
  }
  const kept = out.filter((word) => !CONNECTORS.has(word))
  if (kept.length > 0) out = kept
  if (!keepThe && out.length > 1 && out[0] === 'the') out = out.slice(1)
  return out
}

/**
 * Every way a text may be read: the short form (brackets, a spaced dash tail
 * and a feat. tail dropped) and the full form (all its words), each also with
 * number words as digits, without duplicates or empty keys. The first is the
 * group key's form. A text with no letter or digit has one empty form.
 *
 * `accepted` reads an accepted text (the truth or an extra) in more ways,
 * after the usual ones: with its leading "the" kept, so "Teh Lanterns" is one
 * letter from "The Lanterns"; and with Mister, Saint, Doctor and the like as
 * written and spelled out, so "Docter Lind" is one letter from "Doctor Lind".
 * A kept "the" stays first in the sorted key, so "Lanterns, The" stays close.
 */
export function forms(text: string, accepted = false): Form[] {
  let s = String(text).normalize('NFKC').toLowerCase()
  for (const [from, to] of LETTERS) s = s.replace(from, to)
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  s = s.replace(/[&+]/g, ' and ')
  s = s.replace(/['‘’`´]/g, '')
  const full = s.replace(/[()[\]{}]/g, ' ')
  const short = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ').split(/\s[-\u2013\u2014]\s/)[0]
  const out: Form[] = []
  const seen = new Set<string>()
  const add = (words: string[], keptThe: boolean) => {
    const key = fold(words.join(''))
    if (!key || seen.has(key)) return
    seen.add(key)
    const sorted = keptThe ? ['the', ...words.slice(1).sort()] : [...words].sort()
    out.push({ key, sorted: fold(sorted.join('')), words: words.map(fold) })
  }
  const read = (same: SameWords, keepThe: boolean) => {
    for (const [form, cut] of [
      [short, true],
      [full, false],
    ] as const) {
      const words = tidy(wordsOf(form, same), cut, keepThe)
      const keptThe = keepThe && words.length > 1 && words[0] === 'the'
      if (keepThe && !keptThe) continue
      const digits = asDigits(words)
      if (digits) add(digits, keptThe)
      add(words, keptThe)
    }
  }
  read('short', false)
  if (accepted) {
    for (const same of ['kept', 'long'] as const) read(same, false)
    for (const same of ['short', 'kept', 'long'] as const) read(same, true)
  }
  if (out.length === 0) out.push({ key: '', sorted: '', words: [] })
  return out
}

/** A number from 0 to 99 in English words: 7 is "seven", 22 is "twenty two". */
function numberWords(n: number): string {
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  const ones = n % 10
  return ones === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]} ${ONES[ones]}`
}

/** The text with its numbers 0 to 99 spelled out ("7 Years" is "seven Years") and the words it spelled, or null when it has none. */
function spelledOut(text: string): { text: string; words: string[] } | null {
  const words: string[] = []
  const out = text.replace(/\d+/g, (digits) => {
    const n = Number(digits)
    if (digits.length > 2) return digits
    words.push(...numberWords(n).split(' '))
    return ` ${numberWords(n)} `
  })
  return words.length > 0 ? { text: out, words } : null
}

/**
 * Every way an accepted text may be read (forms with `accepted`), and the
 * same with its numbers spelled out, so a typo in a number word counts
 * whether the host typed "7 Years" or "Seven Years". A typed key with digits
 * never meets a spelled-out key, so "Route 14" is still not "Route 41".
 */
export function acceptedForms(text: string): Form[] {
  const out = forms(text, true)
  const spelled = spelledOut(text)
  if (spelled === null) return out
  const seen = new Set(out.map((form) => form.key))
  for (const form of forms(spelled.text, true)) {
    if (!form.key || seen.has(form.key)) continue
    seen.add(form.key)
    out.push({ ...form, numberWords: spelled.words.map(fold) })
  }
  return out
}

/** An answer's group key: its short form, number words as digits. How the host's review groups answers, and what Accept names. */
export const normalise = (text: string): string => forms(text)[0].key

/** About one wrong letter in five: none up to 4 letters, 1 from 5, 2 from 10, 3 from 15. */
export const typosAllowed = (length: number): number => Math.floor(Math.max(0, length) / 5)

/** Optimal string alignment distance: an insert, a delete, a change or a swap of two neighbours each count once. */
export function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[m][n]
}

/** The numbers in a key, in order: "route41" has "41". */
const numbersIn = (key: string) => (key.match(/[0-9]+/g) ?? []).join(' ')

/**
 * Within the allowance of an accepted key: the first character right, the
 * same numbers (a number never takes a typo), and at most one wrong letter in
 * five of the accepted key's length.
 */
export const within = (typed: string, accepted: string): boolean =>
  typed.length > 0 &&
  typed[0] === accepted[0] &&
  numbersIn(typed) === numbersIn(accepted) &&
  distance(typed, accepted) <= typosAllowed(accepted.length)

/** One word matches another: the same, or within its allowance. */
const wordMatches = (typed: string, accepted: string) => typed === accepted || within(typed, accepted)

/** Every word of `small` matches a different word of `big`. */
function wordsIn(small: readonly string[], big: readonly string[]): boolean {
  const left = [...big]
  for (const word of small) {
    const at = left.findIndex((other) => wordMatches(word, other))
    if (at < 0) return false
    left.splice(at, 1)
  }
  return true
}

const WRONG: Judgement = { verdict: 'wrong', reason: null, off: null }

/**
 * How the rule judges a typed answer to one part of one song, against the
 * accepted texts (the truth first, then the settings' extras) and the other
 * part's accepted texts (for "That's the singer"). exact and typo count;
 * close and wrong count only when the host accepts them.
 */
export function judge(answer: string, part: TypedPart, accepted: readonly string[], otherPart: readonly string[]): Judgement {
  const mine = forms(answer)
  if (!mine[0].key) return WRONG
  // Every accepted text's usual forms first, then the kinder readings, so a close reason is found on the usual ones first.
  const theirs: Form[] = []
  const seen = new Set<string>()
  for (const form of [...accepted.flatMap((text) => forms(text)), ...accepted.flatMap((text) => acceptedForms(text))]) {
    if (!form.key || seen.has(form.key)) continue
    seen.add(form.key)
    theirs.push(form)
  }
  const pairs: [string, string, boolean][] = []
  for (const a of mine) {
    for (const t of theirs) {
      // A number never takes a typo, spelled out too: "Paper Parade" or "Paper Parade one" is not "Paper Parade 2".
      const saysNumber = !t.numberWords || t.numberWords.every((word) => a.words.some((typed) => wordMatches(typed, word)))
      pairs.push([a.key, t.key, saysNumber])
      if (part === 'singer') pairs.push([a.sorted, t.sorted, saysNumber])
    }
  }
  if (pairs.some(([a, t]) => a === t)) return { verdict: 'exact', reason: null, off: null }
  if (pairs.some(([a, t, saysNumber]) => saysNumber && within(a, t))) return { verdict: 'typo', reason: null, off: null }

  // Close: worth one look from the host. The first reason that fits.
  if (otherPart.length > 0) {
    const other = judge(answer, part === 'title' ? 'singer' : 'title', otherPart, []).verdict
    if (other === 'exact' || other === 'typo') return { verdict: 'close', reason: 'otherPart', off: null }
  }
  const letters = mine[0].key.length
  for (const a of mine) {
    for (const t of theirs) {
      const sameCount = a.words.length === t.words.length
      const inOrder = sameCount && a.words.every((word, i) => wordMatches(word, t.words[i]))
      if (part === 'title' && sameCount && !inOrder && a.words.length > 1 && wordsIn(a.words, t.words)) {
        return { verdict: 'close', reason: 'order', off: null }
      }
      if (letters >= 4 && a.words.length < t.words.length && wordsIn(a.words, t.words)) {
        return { verdict: 'close', reason: 'part', off: null }
      }
      if (a.words.length > t.words.length && wordsIn(t.words, a.words)) return { verdict: 'close', reason: 'extra', off: null }
    }
  }
  let best: number | null = null
  for (const [a, t] of pairs) {
    const d = distance(a, t)
    if (d <= typosAllowed(t.length) + 2 && (best === null || d < best)) best = d
  }
  if (best !== null) return { verdict: 'close', reason: 'spelling', off: best }
  return WRONG
}

/** True for a verdict that scores without the host. */
export const counts = (verdict: Verdict): boolean => verdict === 'exact' || verdict === 'typo'
