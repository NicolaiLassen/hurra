// The rehearsal's Lydspor player (docs/engine-v2.md, 3.6 and 8.5). Its songs,
// photos and answers are invented: the owner's real songs live only in the
// game's settings on the night, never here. Relative imports only, no React,
// no browser globals, randomness only from sight.random: the rehearsal runs
// this under Node.
import type { BotMove, BotSight, GameBot, HostBotSight } from '../core/bot'
import type { AnswerPayload } from '../core/Game'
import { NO_PHOTO, promptKey, type SoundtrackConfig, type SoundtrackState, type TypedPart } from './types'

/**
 * Eight invented songs, each with one extra accepted answer per part. The
 * scripted round plays the first three; a rehearsal of the night's length
 * plays all eight (botSettings), and the guests type answers to every one.
 */
export const BOT_SONGS = [
  { title: 'Paper Lanterns', singer: 'Mira Holm', alsoTitle: 'Lanterns', alsoSinger: 'Mira', caption: 'The harbour, 2009', moment: 'The harbour party when the boat broke down', alsoMoment: 'Harbour party 2009' },
  { title: 'Seven Ferries', singer: 'Coldwave', alsoTitle: 'The Ferry Song', alsoSinger: 'Cold Wave Band', caption: 'Island trip, 2014', moment: 'Island trip with the whole class', alsoMoment: 'Class trip 2014' },
  { title: 'Blå Mandag', singer: 'Søren Bækgaard', alsoTitle: 'Mandag', alsoSinger: 'Søren B', caption: 'First flat, 2019', moment: 'Moving into the first flat', alsoMoment: 'First flat' },
  { title: 'Route 41', singer: 'The Pale Harbour', alsoTitle: 'The Long Road', alsoSinger: 'Pale Harbour Band', caption: 'The road trip, 2012', moment: 'Road trip down the coast in the old van', alsoMoment: 'The road trip' },
  { title: 'Sommer i Skagen', singer: 'Ærø Kvartet', alsoTitle: 'Skagen', alsoSinger: 'Kvartetten', caption: 'Skagen, 2016', moment: 'Summer holiday in Skagen', alsoMoment: 'Skagen 2016' },
  { title: 'Glasshouse Summer (Live)', singer: 'Nora Lind feat. Otto Berg', alsoTitle: 'Glasshouse', alsoSinger: 'Nora', caption: 'The festival, 2018', moment: 'Roskilde Festival, first time camping', alsoMoment: 'Roskilde 2018' },
  { title: 'Midnight Ferry Lights', singer: 'Kasper Holt', alsoTitle: 'Ferry Lights', alsoSinger: 'Holt', caption: 'New Year, 2020', moment: 'New Year on the ferry to Oslo', alsoMoment: 'Oslo ferry' },
  { title: 'Copper Sky', singer: 'Linnea Vass', alsoTitle: 'Kobberhimmel', alsoSinger: 'Linnea', caption: 'The wedding, 2023', moment: 'Dancing at the wedding in the barn', alsoMoment: 'The wedding' },
] as const

const SONG_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']

/**
 * Settings for a scripted round of 1 to 8 of the bot's songs, with sample
 * photo paths: 2 extra photos up to 3 songs, else 4; a short last call;
 * the top 5 every 2 songs up to 3, else 4.
 */
export function botSettings(count = 3, momentTyped = false, momentPhoto: 'wall' | 'shown' = 'shown'): Record<string, unknown> {
  const onWall = momentTyped && momentPhoto === 'wall'
  const songs = BOT_SONGS.slice(0, Math.max(1, Math.min(BOT_SONGS.length, count)))
  const extras = songs.length <= 3 ? 2 : 4
  return {
    songs: songs.map((song, i) => ({
      title: song.title,
      singer: song.singer,
      alsoTitles: [song.alsoTitle],
      alsoSingers: [song.alsoSinger],
      photo: `rehearsal/soundtrack/song-${i + 1}.jpg`,
      caption: song.caption,
      startAt: 30 + i * 15,
      note: '',
      ...(momentTyped ? { moment: song.moment, alsoMoments: [song.alsoMoment] } : {}),
    })),
    extraPhotos: [
      { photo: 'rehearsal/soundtrack/extra-1.jpg', caption: 'A wedding, 2016' },
      { photo: 'rehearsal/soundtrack/extra-2.jpg', caption: 'The festival, 2011' },
      { photo: 'rehearsal/soundtrack/extra-3.jpg', caption: 'Moving day, 2021' },
      { photo: 'rehearsal/soundtrack/extra-4.jpg', caption: 'Ski trip, 2017' },
    ].slice(0, extras),
    points: onWall ? { event: 1, title: 1, singer: 1, moment: 2 } : { event: 2, title: 1, singer: 1 },
    lastCallSeconds: 20,
    standingsEvery: songs.length <= 3 ? 2 : 4,
    hints: false,
    ...(momentTyped ? { momentTyped: true } : {}),
    ...(onWall ? { momentPhoto: 'wall' } : {}),
    boardMax: 20,
    intro: `${SONG_WORDS[songs.length]} songs from a rehearsal.`,
    storyteller: 'The host',
    sitOut: [],
  }
}

/** Answers that fit none of the songs. */
const WRONG = ['Night Harbour', 'Glass Rain', 'Copper Sun', 'Lake Dancers', 'The Tin Owls', 'Velvet Roads']

/** The scripted host waits this long between its steps. */
const STEP_MS = 3000
const KEY = /^s(\d+)\.(title|singer|event|moment)$/

export const bot: GameBot = {
  /** The first 3 invented songs with sample photo paths, 2 extra photos and a short last call; everyone plays. */
  settings() {
    return botSettings()
  },

  /**
   * With chance 1 in 3: answers an open part it hasn't answered (a typed part
   * right, with a typo, 3 letters off or wrong; a photo at random), or else
   * changes a typed answer, swaps two songs' photos, or finishes a swap by
   * giving a song that shares its photo a free one.
   */
  move(sight: BotSight): BotMove {
    const pub = sight.publicState as { phase?: string; wall?: unknown[]; lockAt?: number | null } | null
    const view = sight.view as { sittingOut?: boolean } | null
    if (!pub || (pub.phase !== 'playing' && pub.phase !== 'lastCall') || view?.sittingOut) return null
    if (typeof pub.lockAt === 'number' && sight.now >= pub.lockAt) return null
    const wallSize = Array.isArray(pub.wall) ? pub.wall.length : 0
    const open = sight.prompts.filter((p) => KEY.test(p.key) && p.closedAt === null && p.revealedAt === null)
    if (open.length === 0 || sight.random() >= 1 / 3) return null

    const photos = new Map<number, number>()
    for (const prompt of open) {
      const [, n, part] = KEY.exec(prompt.key)!
      if (part !== 'event') continue
      const photo = photoIn(sight.myAnswers[prompt.key])
      if (photo !== null) photos.set(Number(n), photo)
    }
    const free = Array.from({ length: wallSize }, (_, k) => k).filter((k) => ![...photos.values()].includes(k))

    // Finish a swap: a song sharing its photo with another takes a free one.
    const shared = [...photos].find(([n, photo]) => [...photos].some(([m, other]) => m !== n && other === photo))
    if (shared && free.length > 0) return answer(promptKey(shared[0], 'event'), { choice: [String(pick(free, sight.random))] })

    const unanswered = open.filter((p) => !(p.key in sight.myAnswers))
    if (unanswered.length > 0) {
      const prompt = pick(unanswered, sight.random)
      const [, n, part] = KEY.exec(prompt.key)!
      if (part === 'event') return answer(prompt.key, { choice: [free.length > 0 ? String(pick(free, sight.random)) : NO_PHOTO] })
      return answer(prompt.key, { text: typed(Number(n), part as TypedPart, sight.random) })
    }

    const roll = sight.random()
    if (roll < 0.15) {
      const prompt = pick(open.filter((p) => !p.key.endsWith('.event')), sight.random)
      if (!prompt) return null
      const [, n, part] = KEY.exec(prompt.key)!
      return answer(prompt.key, { text: typed(Number(n), part as TypedPart, sight.random) })
    }
    if (roll < 0.3 && photos.size >= 2) {
      // The first write of a swap: this song takes another song's photo; a later move gives that one a free photo.
      const [[n], [, photo]] = shuffled([...photos], sight.random)
      return answer(promptKey(n, 'event'), { choice: [String(photo)] })
    }
    return null
  },

  /**
   * Plays the songs 3 s apart, then Last call (the timer locks); reveals 3 s
   * apart, accepting the first close title of each reveal and showing the top
   * 5 when the settings say, then crowns Lydspor.
   */
  hostMove(sight: HostBotSight) {
    const state = sight.state as SoundtrackState | null
    const config = sight.config as SoundtrackConfig | null
    if (!state || !config || !Array.isArray(config.songs) || !Array.isArray(state.playedAt)) return null
    const played = state.playedAt.length
    const lastPlayed = state.playedAt[played - 1] ?? 0
    switch (state.phase) {
      case 'lobby':
        return { action: { type: 'play', index: 0 } }
      case 'playing':
        if (sight.now - lastPlayed < STEP_MS) return null
        return played < config.songs.length ? { action: { type: 'play', index: played } } : { action: { type: 'lastCall', after: played } }
      case 'locked':
      case 'reveal':
      case 'standings': {
        const { revealed } = state
        const current = state.review?.[revealed - 1]?.title ?? []
        if (state.phase === 'reveal' && revealed > 0 && !current.some((row) => row.accepted)) {
          const close = current.find((row) => row.verdict === 'close')
          if (close) return { action: { type: 'accept', index: revealed - 1, part: 'title', key: close.key, accepted: true } }
        }
        if (sight.now - (state.lockedAt ?? 0) < STEP_MS * (revealed + 1)) return null
        if (state.phase === 'reveal' && config.standingsEvery > 0 && (revealed % config.standingsEvery === 0 || revealed === played)) {
          return { action: { type: 'standings', after: revealed } }
        }
        return revealed < played ? { action: { type: 'reveal', index: revealed } } : { action: { type: 'crown' } }
      }
    }
    return null
  },
}

const answer = (key: string, payload: AnswerPayload): BotMove => ({ kind: 'answer', key, answer: payload })

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The wall index an event answer holds, or null. */
function photoIn(payload: AnswerPayload | undefined): number | null {
  if (!payload || !('choice' in payload) || payload.choice[0] === NO_PHOTO) return null
  const k = Number(payload.choice[0])
  return Number.isInteger(k) ? k : null
}

/** What a guest types for song n's part: right 55 percent, one typo 20, three letters off 10, wrong 15. */
export function typed(n: number, part: TypedPart, random: () => number): string {
  const song = BOT_SONGS[n - 1]
  if (!song) return pick(WRONG, random)
  const right = part === 'title' ? song.title : part === 'singer' ? song.singer : song.moment
  const roll = random()
  if (roll < 0.55) return random() < 0.5 ? right.toLowerCase() : right
  // A slip inside a word: with a leading "The" dropped, a word's first letter can be the answer's first, which must be right.
  if (roll < 0.75) return misspell(right, 1, random, true)
  if (roll < 0.85) return misspell(right, 3, random)
  return pick(WRONG, random)
}

/**
 * The text with `count` neighbouring letters swapped or changed, never the
 * first letter; with `inWords`, never the first letter of any word either.
 */
export function misspell(text: string, count: number, random: () => number, inWords = false): string {
  const letters = Array.from(text)
  const inner = letters
    .map((_, i) => i)
    .filter(
      (i) =>
        i > 0 &&
        i < letters.length - 1 &&
        /\p{L}/u.test(letters[i]) &&
        /\p{L}/u.test(letters[i + 1]) &&
        (!inWords || /\p{L}/u.test(letters[i - 1])),
    )
  if (inner.length === 0) return text
  if (count === 1) {
    const i = pick(inner, random)
    ;[letters[i], letters[i + 1]] = [letters[i + 1], letters[i]]
    return letters.join('')
  }
  for (const i of shuffled(inner, random).slice(0, count)) letters[i] = letters[i] === 'x' ? 'q' : 'x'
  return letters.join('')
}
