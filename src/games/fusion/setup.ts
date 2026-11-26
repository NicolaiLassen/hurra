// Participant fusion's readiness in the host's Games panel (GameModule.setupStatus):
// every picture with its image and the two names in it, and the timing and
// points the start accepts. The names are typed, not tied to the guest list
// (docs/engine-v2.md, 8.4): a name that matches nobody here or on the list is
// counted, as the settings editor flags it, but it never holds the game back,
// since a picture may be of someone who never joins. Each person's own photo
// is optional: the line says how many are missing.
import type { GameGuest } from '@/games/core/Game'
import { nameFromSetting, nameKey } from '@/games/core/names'
import { counted, need, readyLine, type SetupStatus } from '@/games/core/setup'
import { FusionGame, type FusionConfig, type FusionPicture } from '@/games/fusion/logic'
import { nameStatus } from '@/games/fusion/people'

const game = new FusionGame()

/** How a picture's two people read: two names, fewer, the same name twice, or an old guest id on no list any more. */
type People = { kind: 'two'; names: [string, string] } | { kind: 'missing' } | { kind: 'same' } | { kind: 'gone' }

/**
 * The picture's two people as names, as the start reads them: typed names
 * cleaned, a guest's id from settings saved before names turned into that
 * guest's name.
 */
function peopleOf(picture: FusionPicture, guests: readonly GameGuest[]): People {
  const raw = Array.isArray(picture?.people) ? picture.people.filter((value) => typeof value === 'string') : []
  const names = raw.map((value) => nameFromSetting(value, guests)).filter((name) => name !== '')
  if (names.some((name) => name === null)) return { kind: 'gone' }
  const typed = names as string[]
  if (typed.length < 2) return { kind: 'missing' }
  if (nameKey(typed[0]) === nameKey(typed[1])) return { kind: 'same' }
  return { kind: 'two', names: [typed[0], typed[1]] }
}

/** How many of the picture's two people have their own photo: 0 to 2. */
function originalsOf(picture: FusionPicture): number {
  const originals = Array.isArray(picture?.originals) ? picture.originals : []
  return [originals[0], originals[1]].filter((path) => typeof path === 'string' && path !== '').length
}

/** "1 name matches nobody here or on the guest list", or nothing when every name does. */
function unknownNote(count: number): string {
  if (count === 0) return ''
  return `. ${counted(count, 'name')} ${count === 1 ? 'matches' : 'match'} nobody here or on the guest list`
}

export function fusionSetup(config: FusionConfig, guests: readonly GameGuest[]): SetupStatus {
  const pictures: FusionPicture[] = Array.isArray(config?.pictures) ? config.pictures : []
  if (pictures.length === 0) return { ready: false, line: 'No pictures yet' }

  let missing = 0
  let same = 0
  let gone = 0
  let noImage = 0
  let unknown = 0
  let photos = 0
  let ready = 0
  for (const picture of pictures) {
    const people = peopleOf(picture, guests)
    const image = typeof picture?.image === 'string' && picture.image !== ''
    if (people.kind === 'missing') missing++
    if (people.kind === 'same') same++
    if (people.kind === 'gone') gone++
    if (people.kind === 'two') unknown += people.names.filter((name) => nameStatus(name, guests, []) === 'unknown').length
    if (!image) noImage++
    if (people.kind === 'two' && image) ready++
    photos += originalsOf(picture)
  }
  const note = unknownNote(unknown)

  if (ready < pictures.length) {
    const line = readyLine(ready, pictures.length, ['picture', 'pictures'], [
      need(missing, 'two names'),
      need(same, 'two different names'),
      { count: gone, one: 'names someone no longer on the guest list', many: 'name someone no longer on the guest list' },
      need(noImage, 'an image'),
    ])
    return { ready: false, line: `${line}${note}` }
  }

  // Every picture is set: the timing and the points as the start checks them.
  try {
    game.parseConfig(config as unknown as Record<string, unknown>)
  } catch (error) {
    return { ready: false, line: (error as Error).message }
  }

  const all = counted(pictures.length, 'picture')
  const slots = pictures.length * 2
  if (photos >= slots) return { ready: true, line: `${all}, all with two names and own photos${note}` }
  return { ready: true, line: `${all}, all with two names${note}. Own photos (optional): ${photos} of ${slots}` }
}
