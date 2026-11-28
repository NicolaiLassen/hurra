// Lydspor's readiness in the host's Games panel (GameModule.setupStatus), from
// its own check (checkConfig) placed under what each problem is about, as the
// settings editor places them: a song is ready when none of the game's
// problems is about it. Warnings never hold the game back.
import { counted, lowerFirst, need, readyLine, type Need, type SetupStatus } from '@/games/core/setup'
import { placeIssues } from '@/games/soundtrack/editor/settings'
import { checkConfig } from '@/games/soundtrack/logic'
import type { SoundtrackConfig } from '@/games/soundtrack/types'

// The guest list doesn't change whether Lydspor is ready: who sits out is optional, and it is typed names
// ("Doesn't play this game"), so a name nobody joins with changes nothing.
export function soundtrackSetup(raw: SoundtrackConfig): SetupStatus {
  const { config, problems, warnings } = checkConfig(raw)
  const songs = config.songs
  if (songs.length === 0) return { ready: false, line: 'No songs yet' }

  const placed = placeIssues(problems, warnings, songs, config.extraPhotos.length)
  const open = placed.songs.map((issues) => issues.some((issue) => issue.kind === 'problem'))
  const count = (test: (i: number) => boolean) => open.filter((isOpen, i) => isOpen && test(i)).length
  const noPhoto = count((i) => songs[i].photo === '')
  const noWords = count((i) => songs[i].title === '' || songs[i].singer === '')
  // Typed moments: each song needs its moment, and the caption is optional.
  const typed = config.momentTyped === true
  const lacksMoment = (i: number) => typed && (songs[i].moment ?? '') === ''
  const lacksCaption = (i: number) => !typed && songs[i].caption === ''
  const noMoment = count(lacksMoment)
  const noCaption = count(lacksCaption)
  // A song whose problem is something else: too long, a photo to upload again, the same title twice.
  const other = count((i) => songs[i].photo !== '' && songs[i].title !== '' && songs[i].singer !== '' && !lacksMoment(i) && !lacksCaption(i))
  const needs: Need[] = [
    need(noPhoto, 'a photo'),
    need(noWords, 'a title and singer'),
    need(noMoment, 'a moment'),
    need(noCaption, 'a caption'),
    need(other, 'a fix'),
  ]
  const ready = open.filter((isOpen) => !isOpen).length
  const songsLine = readyLine(ready, songs.length, ['song', 'songs'], needs)

  // The rest: the extra photos, the points, the pace, the intro and the storyteller.
  const rest = [...placed.extras.flat(), ...Object.values(placed.fields).flat()].filter((issue) => issue.kind === 'problem')
  if (rest.length > 0) {
    if (ready < songs.length) return { ready: false, line: `${songsLine}. ${counted(rest.length, 'other setting')} to fix` }
    return { ready: false, line: `${songsLine}, but ${lowerFirst(rest[0].text)}` }
  }
  if (ready < songs.length) return { ready: false, line: songsLine }

  // Typed moments use no extra photos: the line doesn't count them.
  const extras = typed && config.momentPhoto !== 'wall' ? 0 : config.extraPhotos.length
  return { ready: true, line: extras > 0 ? `${counted(songs.length, 'song')} and ${counted(extras, 'extra photo')} ready` : songsLine }
}
