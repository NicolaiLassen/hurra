// Participant fusion's readiness in the host's Games panel (GameModule.setupStatus):
// every picture with its image and its two people, all still on the guest
// list, and the timing and points the start accepts. Each person's own photo
// is optional: the line says how many are missing, but they never hold the
// game back.
import type { GameGuest, PlayerId } from '@/games/core/Game'
import { counted, need, readyLine, type SetupStatus } from '@/games/core/setup'
import { FusionGame, type FusionConfig, type FusionPicture } from '@/games/fusion/logic'

const game = new FusionGame()

/** The picture's two people, or null while it has fewer, or the same person twice. */
function pairOf(picture: FusionPicture): [PlayerId, PlayerId] | null {
  const people = Array.isArray(picture?.people) ? picture.people.filter((id) => typeof id === 'string' && id !== '') : []
  return people.length === 2 && people[0] !== people[1] ? [people[0], people[1]] : null
}

/** How many of the picture's two people have their own photo: 0 to 2. */
function originalsOf(picture: FusionPicture): number {
  const originals = Array.isArray(picture?.originals) ? picture.originals : []
  return [originals[0], originals[1]].filter((path) => typeof path === 'string' && path !== '').length
}

export function fusionSetup(config: FusionConfig, guests: readonly GameGuest[]): SetupStatus {
  const pictures: FusionPicture[] = Array.isArray(config?.pictures) ? config.pictures : []
  if (pictures.length === 0) return { ready: false, line: 'No pictures yet' }

  const listed = new Set(guests.map((g) => g.id))
  let noPeople = 0
  let gone = 0
  let noImage = 0
  let photos = 0
  let ready = 0
  for (const picture of pictures) {
    const pair = pairOf(picture)
    const left = pair !== null && !pair.every((id) => listed.has(id))
    const image = typeof picture?.image === 'string' && picture.image !== ''
    if (!pair) noPeople++
    if (left) gone++
    if (!image) noImage++
    if (pair && !left && image) ready++
    photos += originalsOf(picture)
  }

  if (ready < pictures.length) {
    return {
      ready: false,
      line: readyLine(ready, pictures.length, ['picture', 'pictures'], [
        need(noPeople, 'both its people', 'both their people'),
        { count: gone, one: 'names someone no longer on the guest list', many: 'name someone no longer on the guest list' },
        need(noImage, 'an image'),
      ]),
    }
  }

  // Every picture is set: the timing and the points as the start checks them.
  try {
    game.parseConfig(config as unknown as Record<string, unknown>)
  } catch (error) {
    return { ready: false, line: (error as Error).message }
  }

  const all = counted(pictures.length, 'picture')
  const slots = pictures.length * 2
  if (photos >= slots) return { ready: true, line: `${all}, all with their people and own photos` }
  return { ready: true, line: `${all}, all with their people. Own photos (optional): ${photos} of ${slots}` }
}
