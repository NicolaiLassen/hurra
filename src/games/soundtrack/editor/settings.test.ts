import { describe, expect, it } from 'vitest'
import { checkConfig, SoundtrackGame } from '../logic'
import { sampleSettings } from '../samples'
import { emptySong, parseStart, placeIssues, readSettings, wholeFrom } from './settings'

const cast = { players: ['Ana', 'Bo', 'Clara', 'Sofie', 'Emil', 'Lars', 'Ida'].map((name, i) => ({ id: `p${i}`, name })) }

describe('reading the saved settings', () => {
  it("fills what is missing with the game's defaults", () => {
    const read = readSettings(null)
    expect(read).toEqual(new SoundtrackGame().defaultConfig)
    expect(readSettings({ songs: [{ title: 'Glow' }], points: { title: 2 } })).toMatchObject({
      songs: [{ ...emptySong(), title: 'Glow' }],
      points: { event: 2, title: 2, singer: 1 },
      lastCallSeconds: 60,
    })
  })

  it('keeps text as typed, so a space typed before the next word survives', () => {
    expect(readSettings({ songs: [{ title: 'Paper ', alsoTitles: ['Old ', ''] }], storyteller: 'Ida ' })).toMatchObject({
      songs: [{ title: 'Paper ', alsoTitles: ['Old ', ''] }],
      storyteller: 'Ida ',
    })
  })

  it('reads the sample settings back as they are', () => {
    const settings = sampleSettings(cast)
    expect(readSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
  })
})

describe('the hook start', () => {
  it('takes m:ss or whole seconds within the first hour', () => {
    expect(parseStart('0:48')).toBe(48)
    expect(parseStart(' 1:02 ')).toBe(62)
    expect(parseStart('48')).toBe(48)
    expect(parseStart('59:59')).toBe(3599)
    expect(parseStart('60:00')).toBeNull()
    expect(parseStart('1:2')).toBeNull()
    expect(parseStart('1:75')).toBeNull()
    expect(parseStart('abc')).toBeNull()
    expect(parseStart('')).toBeNull()
  })

  it('reads number fields as whole numbers', () => {
    expect([wholeFrom('3'), wholeFrom(''), wholeFrom('2.6'), wholeFrom('x')]).toEqual([3, 0, 3, 0])
  })
})

describe("placing the game's problems and warnings", () => {
  it('puts each under the song, the photo or the field it is about', () => {
    const settings = sampleSettings(cast)
    settings.songs[1] = { ...settings.songs[1], photo: '', caption: 'A caption far longer than twenty' }
    settings.songs[4] = { ...settings.songs[4], title: 'Paper Lanterns' }
    settings.extraPhotos = settings.extraPhotos.slice(0, 1).map((p) => ({ ...p, caption: '' }))
    settings.lastCallSeconds = 5
    const { problems, warnings } = checkConfig(settings)
    const placed = placeIssues(problems, warnings, settings.songs, settings.extraPhotos.length)

    expect(placed.songs[1]).toContainEqual({ text: 'Song 2 needs its photo', kind: 'problem' })
    expect(placed.songs[1]).toContainEqual({ text: 'The caption is at most 30 characters', kind: 'problem' })
    // Two songs with the same title: under both.
    expect(placed.songs[0]).toContainEqual({ text: 'Two songs are called Paper Lanterns', kind: 'problem' })
    expect(placed.songs[4]).toContainEqual({ text: 'Two songs are called Paper Lanterns', kind: 'problem' })
    expect(placed.extras[0]).toEqual([{ text: 'Extra photo 1 needs a caption', kind: 'problem' }])
    expect(placed.fields.extras.map((i) => i.text)).toEqual([
      "Add at least 2 extra photos, so the last song's photo isn't free",
      'Only 1 extra photo: 4 keep the last songs hard to place.',
    ])
    expect(placed.fields.lastCall).toEqual([{ text: 'Last call takes 20 to 180 seconds', kind: 'problem' }])
    // A short singer and a feat. part warn under their song; a shared singer under the later song.
    expect(placed.songs[4].map((i) => i.text)).toContain('The singer is short: only the exact spelling counts. Add extra answers if it has a common misspelling.')
    expect(placed.songs[7].map((i) => i.text)).toContain('Only Mira Holm is needed to score: the feat. part may be left out.')

    // Everything lands somewhere.
    const all = [...placed.songs.flat(), ...placed.extras.flat(), ...Object.values(placed.fields).flat()]
    expect(all.filter((i) => i.kind === 'problem').length).toBeGreaterThanOrEqual(problems.length)
    expect(all.filter((i) => i.kind === 'warning').length).toBe(warnings.length)
  })

  it('puts the empty list under the songs', () => {
    const { problems, warnings } = checkConfig(readSettings(null))
    expect(placeIssues(problems, warnings, [], 0).fields.songs).toEqual([{ text: 'Add at least one song in the settings', kind: 'problem' }])
  })
})
