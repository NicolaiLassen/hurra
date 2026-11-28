import { describe, expect, it } from 'vitest'
import { sampleSettings } from './samples'
import { soundtrackSetup } from './setup'
import type { SoundtrackConfig, SoundtrackSong } from './types'

const cast = { players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id) => ({ id, name: id })) }
const sample = () => sampleSettings(cast)
const withSongs = (change: (song: SoundtrackSong, n: number) => Partial<SoundtrackSong>, base: SoundtrackConfig = sample()): SoundtrackConfig => ({
  ...base,
  songs: base.songs.map((song, i) => ({ ...song, ...change(song, i + 1) })),
})

describe('Lydspor’s readiness', () => {
  it('is ready with its 8 songs and 4 extra photos', () => {
    expect(soundtrackSetup(sample())).toEqual({ ready: true, line: '8 songs and 4 extra photos ready' })
  })

  it('counts the songs still without a photo, as its own check finds them', () => {
    const settings = withSongs((_, n) => (n === 3 || n === 6 ? { photo: '' } : {}))
    expect(soundtrackSetup(settings)).toEqual({ ready: false, line: '6 of 8 songs ready: 2 need a photo' })
  })

  it('names each kind of work left, a song once under each it needs', () => {
    const settings = withSongs((_, n) => (n === 1 ? { photo: '', caption: '' } : n === 2 ? { singer: '' } : n === 4 ? { caption: '   ' } : {}))
    expect(soundtrackSetup(settings)).toEqual({
      ready: false,
      line: '5 of 8 songs ready: 1 needs a photo, 1 needs a title and singer, 2 need a caption',
    })
  })

  it('calls any other problem with a song a fix: the same title twice, a title too long', () => {
    const twice = withSongs((_, n) => (n === 5 ? { title: sample().songs[0].title } : {}))
    expect(soundtrackSetup(twice)).toEqual({ ready: false, line: '6 of 8 songs ready: 2 need a fix' })
    const long = withSongs((_, n) => (n === 2 ? { title: 'x'.repeat(61) } : {}))
    expect(soundtrackSetup(long)).toEqual({ ready: false, line: '7 of 8 songs ready: 1 needs a fix' })
  })

  it('says what else the start refuses once every song is ready', () => {
    expect(soundtrackSetup({ ...sample(), extraPhotos: [] })).toEqual({
      ready: false,
      line: "8 songs ready, but add at least 2 extra photos, so the last song's photo isn't free",
    })
    const both = withSongs((_, n) => (n === 1 ? { photo: '' } : {}), { ...sample(), lastCallSeconds: 5 })
    expect(soundtrackSetup(both)).toEqual({ ready: false, line: '7 of 8 songs ready: 1 needs a photo. 1 other setting to fix' })
  })

  it('never holds the game back for a warning', () => {
    const short = withSongs((_, n) => (n === 1 ? { title: 'Ok' } : {}))
    expect(soundtrackSetup(short).ready).toBe(true)
    const two = { ...sample(), songs: sample().songs.slice(0, 2), extraPhotos: [] }
    expect(soundtrackSetup(two)).toEqual({ ready: true, line: '2 songs ready' })
  })

  it('takes who sits out as typed names, a name nobody joins with and an old id alike, and never holds the game back for it', () => {
    expect(soundtrackSetup({ ...sample(), sitOut: ['Zelda', 'p1', '00000000-0000-4000-8000-000000000000'] })).toEqual({
      ready: true,
      line: '8 songs and 4 extra photos ready',
    })
    expect(soundtrackSetup({ ...sample(), sitOut: [] }).ready).toBe(true)
  })

  it('reads songs saved with who is in their photo, which no longer counts', () => {
    const old = withSongs(() => ({ inPhoto: ['p1'] }) as unknown as Partial<SoundtrackSong>)
    expect(soundtrackSetup(old)).toEqual({ ready: true, line: '8 songs and 4 extra photos ready' })
  })

  describe('with typed moments on', () => {
    const typed = () => sampleSettings(cast, true)

    it('is ready with its 8 songs and their moments, no extra photos needed', () => {
      expect(soundtrackSetup(typed())).toEqual({ ready: true, line: '8 songs ready' })
      expect(soundtrackSetup({ ...typed(), extraPhotos: [] })).toEqual({ ready: true, line: '8 songs ready' })
    })

    it('counts the songs still without a moment, and never asks for a caption', () => {
      const settings = withSongs((_, n) => (n === 2 || n === 5 ? { moment: '' } : n === 3 ? { caption: '' } : {}), typed())
      expect(soundtrackSetup(settings)).toEqual({ ready: false, line: '6 of 8 songs ready: 2 need a moment' })
    })

    it('names a moment beside the other work, and calls a moment too long a fix', () => {
      const settings = withSongs((_, n) => (n === 1 ? { photo: '', moment: '' } : n === 4 ? { moment: 'x'.repeat(141) } : {}), typed())
      expect(soundtrackSetup(settings)).toEqual({ ready: false, line: '6 of 8 songs ready: 1 needs a photo, 1 needs a moment, 1 needs a fix' })
    })

    it('keeps the moments out of it with typed moments off', () => {
      const off = withSongs(() => ({ moment: '' }), { ...typed(), momentTyped: false })
      expect(soundtrackSetup(off)).toEqual({ ready: true, line: '8 songs and 4 extra photos ready' })
    })
  })

  it('says when there are no songs, and reads settings with fields missing', () => {
    expect(soundtrackSetup({ ...sample(), songs: [] })).toEqual({ ready: false, line: 'No songs yet' })
    expect(soundtrackSetup({} as SoundtrackConfig)).toEqual({ ready: false, line: 'No songs yet' })
    expect(soundtrackSetup({ songs: [{}] } as unknown as SoundtrackConfig).line).toBe(
      '0 of 1 song ready: 1 needs a photo, 1 needs a title and singer, 1 needs a caption',
    )
  })
})
