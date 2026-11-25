// Lydspor's matching rules against the example table of
// .design/lydspor/spec.md, section 5.3, as it is. Every name is invented: the
// owner's songs live only in the game's settings on the night.
//
// part: which field the guest typed in. accepted: the song's title or singer,
// then the settings' extra accepted answers. other: the song's other part (for
// "That's the singer"). expect: exact | typo (both count) | close:<reason> | wrong.
import { describe, expect, it } from 'vitest'
import { distance, forms, judge, normalise, typosAllowed, within } from './match'
import type { TypedPart } from './types'

type Row = { part: TypedPart; accepted: string[]; other?: string[]; typed: string; expect: string; why: string }

const TABLE: Row[] = [
  // Capitals, spaces, punctuation
  { part: 'singer', accepted: ['Coldwave'], typed: 'COLDWAVE', expect: 'exact', why: 'Capitals never matter' },
  { part: 'singer', accepted: ['Coldwave'], typed: '  coldwave ', expect: 'exact', why: 'Spaces around it are trimmed' },
  { part: 'singer', accepted: ['Coldwave'], typed: 'Cold wave', expect: 'exact', why: 'A space inside a word never matters' },
  { part: 'title', accepted: ['Lighthouse Avenue'], typed: 'light house avenue', expect: 'exact', why: 'Spaces never matter' },
  { part: 'title', accepted: ['Mr. Velvet'], typed: 'Mr Velvet', expect: 'exact', why: 'Full stops never matter' },
  { part: 'title', accepted: ["Don't Look Back, Ida"], typed: 'dont look back ida', expect: 'exact', why: 'Apostrophes and commas never matter' },
  { part: 'title', accepted: ["Don't Look Back, Ida"], typed: 'Don’t look back Ida', expect: 'exact', why: 'A curly apostrophe is the same' },
  { part: 'singer', accepted: ['R.O.S.A.'], typed: 'Rosa', expect: 'exact', why: 'Dots between letters never matter' },
  { part: 'singer', accepted: ['Coldwave'], typed: '?', expect: 'wrong', why: 'Nothing but punctuation is no answer' },

  // Accents and Danish letters
  { part: 'title', accepted: ['Café Nord'], typed: 'Cafe nord', expect: 'exact', why: 'Accents never matter' },
  { part: 'title', accepted: ['Blå Mandag'], typed: 'Bla mandag', expect: 'exact', why: 'å typed as a' },
  { part: 'title', accepted: ['Blå Mandag'], typed: 'Blaa Mandag', expect: 'exact', why: 'å typed as aa' },
  { part: 'singer', accepted: ['Søren Bækgaard'], typed: 'Soren Baekgaard', expect: 'exact', why: 'ø typed as o, æ as ae' },
  { part: 'singer', accepted: ['Søren Bækgaard'], typed: 'Soeren Bækgård', expect: 'exact', why: 'ø typed as oe, aa typed as å' },
  { part: 'singer', accepted: ['Søren Bækgaard'], typed: 'Sören Bakgard', expect: 'exact', why: 'ö for ø, a for æ, a for aa' },
  { part: 'singer', accepted: ['Søren Bækgaard'], typed: 'Søren Bekgaard', expect: 'typo', why: 'e for æ is one wrong letter of 12' },
  { part: 'singer', accepted: ['Chloé Ølstad'], typed: 'Chloe Oelstad', expect: 'exact', why: 'é as e, Ø as Oe' },
  { part: 'title', accepted: ['Ærø i Regn'], typed: 'Aero i regn', expect: 'exact', why: 'Æ as Ae, ø as o' },
  { part: 'title', accepted: ['Ærø i Regn'], typed: 'Ero i regn', expect: 'close:spelling', why: 'One wrong letter, but it is the first one' },

  // & and and
  { part: 'singer', accepted: ['Ditte & Vincent'], typed: 'Ditte and Vincent', expect: 'exact', why: '& and "and" are the same' },
  { part: 'singer', accepted: ['Ditte & Vincent'], typed: 'Ditte og Vincent', expect: 'exact', why: 'The Danish "og" too' },
  { part: 'singer', accepted: ['Ditte & Vincent'], typed: 'Ditte + Vincent', expect: 'exact', why: '+ too' },
  { part: 'singer', accepted: ['Ditte & Vincent'], typed: 'Ditte Vincent', expect: 'exact', why: 'Leaving "and" out is fine' },
  { part: 'title', accepted: ['Salt & Sand'], typed: 'salt and sand', expect: 'exact', why: '& in a title too' },
  { part: 'title', accepted: ["Rock 'n' Roll Harbour"], typed: 'Rock and Roll Harbour', expect: 'exact', why: '"n" is "and"' },
  { part: 'title', accepted: ["Rock 'n' Roll Harbour"], typed: 'Rock & Roll harbor', expect: 'typo', why: '& for n, and harbor is one letter short of 15' },

  // Word order
  { part: 'singer', accepted: ['Ditte & Vincent'], typed: 'Vincent & Ditte', expect: 'exact', why: "A singer's words may come in any order" },
  { part: 'singer', accepted: ['Mira Holm'], typed: 'Holm Mira', expect: 'exact', why: 'Surname first is fine' },
  { part: 'singer', accepted: ['Mira Holm'], typed: 'Holm Mria', expect: 'typo', why: 'Any order, and a swap of two letters counts once' },
  { part: 'title', accepted: ['Salt & Sand'], typed: 'Sand and Salt', expect: 'close:order', why: "A title's words keep their order: the host decides" },

  // feat. and bracketed tails
  { part: 'title', accepted: ['Natlys (Radio Edit)'], typed: 'Natlys', expect: 'exact', why: 'Brackets in the setting drop out' },
  { part: 'title', accepted: ['Natlys - Remastered 2019'], typed: 'natlys', expect: 'exact', why: 'A tail after a spaced dash drops out' },
  { part: 'title', accepted: ['Natlys'], typed: 'Natlys (the radio one)', expect: 'exact', why: "Brackets in the guest's answer drop out too" },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind'], typed: 'Mira Holm', expect: 'exact', why: 'The feat. tail drops out' },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind'], typed: 'Mira Holm ft Kasper Lind', expect: 'exact', why: 'ft is feat.' },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind'], typed: 'Mira Holm and Kasper Lind', expect: 'typo', why: 'Against the full form, "and" for "feat" is 4 of 22' },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind'], typed: 'Kasper Lind', expect: 'close:part', why: 'Only the featured singer: the host decides' },

  // A leading "the"
  { part: 'singer', accepted: ['The Lanterns'], typed: 'Lanterns', expect: 'exact', why: 'A leading "the" never matters' },
  { part: 'singer', accepted: ['Lanterns'], typed: 'the lanterns', expect: 'exact', why: 'Either way round' },
  { part: 'singer', accepted: ['The Lanterns'], typed: 'Lanterns, The', expect: 'close:extra', why: 'Only a leading "the" drops out' },
  { part: 'title', accepted: ['Past the Harbour'], typed: 'Past Harbour', expect: 'close:part', why: 'A "the" inside the title is a word like any other' },

  // Short titles: one letter matters
  { part: 'title', accepted: ['Glow'], typed: 'glow', expect: 'exact', why: 'Right' },
  { part: 'title', accepted: ['Glow'], typed: 'Glov', expect: 'close:spelling', why: 'Up to 4 letters, no wrong letter is allowed' },
  { part: 'title', accepted: ['Fog'], typed: 'Frog', expect: 'close:spelling', why: 'Up to 4 letters, no wrong letter is allowed' },
  { part: 'title', accepted: ['Ember'], typed: 'Embers', expect: 'typo', why: '5 letters allow one' },
  { part: 'title', accepted: ['Ember'], typed: 'Amber', expect: 'close:spelling', why: 'The first letter must be right' },

  // Numbers
  { part: 'title', accepted: ['33'], typed: 'thirty three', expect: 'exact', why: 'Number words are numbers' },
  { part: 'title', accepted: ['33'], typed: 'Thirty-Three', expect: 'exact', why: 'With a hyphen too' },
  { part: 'title', accepted: ['33'], typed: 'thirtythree', expect: 'exact', why: 'Or written together' },
  { part: 'title', accepted: ['33'], typed: '34', expect: 'close:spelling', why: 'A different number never counts by itself' },
  { part: 'title', accepted: ['Seven Ferries'], typed: '7 Ferries', expect: 'exact', why: 'Digits for words' },
  { part: 'title', accepted: ['Seven Ferries'], typed: 'Sevn Ferries', expect: 'typo', why: 'A typo in a number word still counts' },
  { part: 'title', accepted: ['Route 41'], typed: 'Route forty one', expect: 'exact', why: 'Words for digits' },
  { part: 'title', accepted: ['Route 41'], typed: 'Route 14', expect: 'close:spelling', why: 'A number never takes a typo: the host decides' },

  // Wrong letters by length
  { part: 'singer', accepted: ['Coldwave'], typed: 'Colwdave', expect: 'typo', why: 'A swap of two letters counts once: 1 of 8' },
  { part: 'singer', accepted: ['Coldwave'], typed: 'Coldwav', expect: 'typo', why: 'One letter missing of 8' },
  { part: 'singer', accepted: ['Coldwave'], typed: 'Coldwaev', expect: 'typo', why: 'A swap at the end' },
  { part: 'singer', accepted: ['Coldwave'], typed: 'Coldplay', expect: 'wrong', why: '4 wrong letters of 8 is another band' },
  { part: 'singer', accepted: ['Paper Lanterns'], typed: 'Paper Lantrens', expect: 'typo', why: 'A swap: 1 of 13' },
  { part: 'singer', accepted: ['Paper Lanterns'], typed: 'Papr Lantern', expect: 'typo', why: '2 of 13' },
  { part: 'singer', accepted: ['Paper Lanterns'], typed: 'Papir Lanterner', expect: 'close:spelling', why: '3 wrong of 13: the host decides' },
  { part: 'singer', accepted: ['Paper Lanterns'], typed: 'aper Lanterns', expect: 'close:spelling', why: 'The first letter is missing' },
  { part: 'title', accepted: ['Starfall'], typed: 'Star fal', expect: 'typo', why: 'A space and a letter short: 1 of 8' },
  { part: 'title', accepted: ['Mr. Velvet'], typed: 'Mister Velvet', expect: 'exact', why: 'Mister is Mr (also Saint and St, Doctor and Dr)' },

  // Extra accepted answers from the settings
  { part: 'title', accepted: ['Under the Old Oak Tree', 'Old Oak'], typed: 'old oak', expect: 'exact', why: 'An extra accepted answer' },
  { part: 'title', accepted: ['Under the Old Oak Tree', 'Old Oak'], typed: 'Old Oack', expect: 'typo', why: 'Extras forgive typos by their own length' },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind', 'Mira'], typed: 'Mira', expect: 'exact', why: 'A short extra counts exactly' },
  { part: 'singer', accepted: ['Mira Holm feat. Kasper Lind', 'Mira'], typed: 'Mia', expect: 'close:spelling', why: 'But no wrong letter in it' },

  // The other part
  { part: 'title', accepted: ['Natlys'], other: ['Coldwave'], typed: 'Coldwave', expect: 'close:otherPart', why: "The singer in the title field: the host decides" },
  { part: 'singer', accepted: ['Coldwave'], other: ['Natlys'], typed: 'natlys', expect: 'close:otherPart', why: 'The title in the singer field' },
]

describe('the example table', () => {
  it('has all 70 rows', () => {
    expect(TABLE).toHaveLength(70)
  })

  it.each(TABLE.map((row, i) => [i + 1, row] as const))('row %i', (_, row) => {
    const result = judge(row.typed, row.part, row.accepted, row.other ?? [])
    const got = result.verdict === 'close' ? `close:${result.reason}` : result.verdict
    expect(got, `${row.typed} for ${row.accepted[0]}: ${row.why}`).toBe(row.expect)
    // off is set for reason spelling only, and reason for close only.
    expect(result.off !== null).toBe(result.reason === 'spelling')
    expect(result.reason !== null).toBe(result.verdict === 'close')
  })
})

describe('distance', () => {
  it('counts a swap of two neighbours once', () => {
    expect(distance('coldplay', 'coldpaly')).toBe(1)
  })

  it('is the optimal string alignment distance, not full Damerau', () => {
    expect(distance('abc', 'ca')).toBe(3)
  })

  it('counts inserts, deletes and changes', () => {
    expect(distance('', 'abc')).toBe(3)
    expect(distance('coldwave', 'coldwav')).toBe(1)
    expect(distance('ember', 'amber')).toBe(1)
    expect(distance('same', 'same')).toBe(0)
  })
})

describe('typosAllowed', () => {
  it('allows about one wrong letter in five', () => {
    expect([4, 5, 9, 10, 14, 15].map(typosAllowed)).toEqual([0, 1, 1, 2, 2, 3])
    expect(typosAllowed(0)).toBe(0)
  })
})

describe('within', () => {
  it('needs the first letter, the same numbers and the allowance', () => {
    expect(within('coldwav', 'coldwave')).toBe(true)
    expect(within('oldwave', 'coldwave')).toBe(false)
    expect(within('route14', 'route41')).toBe(false)
    expect(within('glov', 'glow')).toBe(false)
  })
})

describe('normalise', () => {
  it('groups spellings that only differ in capitals, punctuation and spaces', () => {
    expect(normalise('Haleluya')).toBe('haleluya')
    expect(normalise('haleluya!')).toBe('haleluya')
    expect(normalise(' HALELUYA')).toBe('haleluya')
  })

  it('groups number words with their digits', () => {
    expect(normalise('Thirty-Three')).toBe(normalise('33'))
    expect(normalise('thirtythree')).toBe('33')
  })

  it('folds Danish spellings together', () => {
    expect(normalise('Blå')).toBe(normalise('Blaa'))
    expect(normalise('Søren')).toBe(normalise('Soeren'))
  })

  it('gives an answer with no letter or digit the empty key', () => {
    expect(normalise('?')).toBe('')
    expect(normalise('  -  ')).toBe('')
    expect(normalise('🎵')).toBe('')
  })
})

describe('forms', () => {
  it('reads the short form first, then the full form, with number variants and no duplicates', () => {
    // Folding is on the joined key: "radioedit" meets "radiodit".
    expect(forms('Natlys (Radio Edit)').map((f) => f.key)).toEqual(['natlys', 'natlysradiodit'])
    expect(forms('Seven Ferries').map((f) => f.key)).toEqual(['7ferries', 'sevenferries'])
    expect(forms('Coldwave').map((f) => f.key)).toEqual(['coldwave'])
  })

  it('sorts a form\'s words for singers', () => {
    const [form] = forms('Mira Holm')
    expect(form.words).toEqual(['mira', 'holm'])
    expect(form.sorted).toBe('holmmira')
  })

  it('cuts a feat. tail in the short form and keeps it in the full one', () => {
    expect(forms('Mira Holm feat. Kasper Lind').map((f) => f.key)).toEqual(['miraholm', 'miraholmfeatkasperlind'])
    expect(forms('Mira Holm ft Kasper Lind').map((f) => f.key)).toEqual(['miraholm', 'miraholmfeatkasperlind'])
  })
})
