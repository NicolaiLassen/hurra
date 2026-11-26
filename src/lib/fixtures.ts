// Typed sample snapshots for every scene (docs/engine-v2.md, 5.11), so the
// phone, TV and host screens and the game views can be previewed and unit
// tested against real shapes without a live party. In dev builds the pages
// read ?fixture=<scene> and pass fixtureSnapshot(scene, screen) to their
// LiveSessionProvider.
//
// The game data here (public_state, views, states) is sample JSON in the
// shapes of section 8, for screens only: no core code reads it. Each screen
// gets what row level security would give it: a phone (as Sofie) gets `me`
// and its own targeted announcements, the TV and the host page get room-wide
// ones only, and only the host page gets `states` (with the quiz's answers and
// the fusion key), `screens` and `guests` (the guest list: the twelve players
// as joined and four guests still expected, docs/guest-list.md).
import { SOUNDTRACK_SCENES, soundtrackSample, type SoundtrackScene } from '@/games/soundtrack/samples'
import type { Screen } from './live'
import type { RecapDoc } from './recap'
import type { AnswerPayload, FeedItem, ListedGuest, Player, PromptState, Session, SessionGame, Snapshot, Tallies } from './types'

/** Participant fusion on the stage (8.4), each with 12 pictures, and some with 2 or 40 as well (`-2`, `-40`). */
export const FUSION_STAGE_SCENES = [
  'fusion-lobby',
  'fusion-lobby-2',
  'fusion-lobby-40',
  'fusion-showing',
  'fusion-showing-2',
  'fusion-showing-40',
  'fusion-wall',
  'fusion-wall-2',
  'fusion-wall-40',
  'fusion-asking',
  'fusion-asking-2',
  'fusion-asking-40',
  'fusion-asking-locked',
  'fusion-asking-you',
  'fusion-reveal',
  'fusion-reveal-2',
  'fusion-reveal-40',
  'fusion-reveal-one',
  'fusion-reveal-none',
  'fusion-reveal-missed',
  'fusion-reveal-you',
  'fusion-reveal-plain',
  'fusion-crown',
  'fusion-final',
] as const

export type FusionStageScene = (typeof FUSION_STAGE_SCENES)[number]

export const FIXTURE_SCENES = [
  'lobby',
  'quiz-question',
  'quiz-reveal',
  'quiz-leaderboard',
  ...FUSION_STAGE_SCENES,
  'fusion-legacy',
  // Lydspor (.design/lydspor/spec.md, 18.2): its lobby, song 5 of 8 playing,
  // the last call, locked, reveal 1 with an accepted close title, the top 5
  // after reveal 4, and the crown.
  ...SOUNDTRACK_SCENES.map((scene) => `soundtrack-${scene}` as const),
  'final',
  'background',
  // Last one standing in the background, with Sofie dealt in late (she joined after the start).
  'latecomer',
  'removed',
  'archived',
] as const

export type FixtureScene = (typeof FIXTURE_SCENES)[number]

export const isFixtureScene = (value: string | null | undefined): value is FixtureScene =>
  FIXTURE_SCENES.includes(value as FixtureScene)

const MIN = 60_000
/** Saturday 28 November 2026, 21:30 in Copenhagen. */
export const FIXTURE_NOW = Date.UTC(2026, 10, 28, 20, 30)

/** Stable, valid UUIDs, so pages that check ids accept them. */
const uid = (kind: number, n: number) => `f1c7a000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, '0')}`

export const FIXTURE_SESSION_ID = uid(1, 1)

const NAMES = ['Ana', 'Bo', 'Mads', 'Sofie', 'Freja', 'Lars', 'Ida', 'Emil', 'Clara', 'Noah', 'Maja', 'Oscar']
/** Guests on the sample party's guest list who haven't joined yet (docs/guest-list.md, 11.1). */
export const FIXTURE_EXPECTED_NAMES = ['Zelda', 'Quentin', 'Ximena', 'Ulrik']
/** More invented names, for a guest list as long as the party is built for. */
const MORE_NAMES = [
  'Astrid', 'Bjørn', 'Cornelia', 'Dagny', 'Elias', 'Filippa', 'Gorm', 'Halfdan', 'Iben', 'Jens Viggo Østergaard',
  'Kamma', 'Leo', 'Merle', 'Nanna', 'Ole', 'Pil', 'Ragnvald', 'Signe-Lykke Kjærsgaard', 'Tove', 'Uffe', 'Vibeke', 'Yrsa',
  'Æbbe', 'Øystein', 'Åse', 'Benedikte', 'Carsten', 'Ditte', 'Eskild',
]

/**
 * The free names of a sample guest list, for the join page's dev fixture
 * (/join/x?fixture=guests): the twelve sample guests and the four still
 * expected, then more invented names up to `count`. In the order a host
 * might paste them; the phone sorts them itself.
 */
export function fixtureFreeNames(count = 16): string[] {
  const names = [...NAMES, ...FIXTURE_EXPECTED_NAMES]
  for (let n = 0; names.length < count; n++) {
    names.push(MORE_NAMES[n % MORE_NAMES.length] + (n >= MORE_NAMES.length ? ` ${Math.floor(n / MORE_NAMES.length) + 1}` : ''))
  }
  return names.slice(0, Math.max(0, count))
}
const CODES = ['A4N7Q', 'B7Q3M', 'M2D5S', 'S9F4X', 'F3R8J', 'L6R2T', 'I5D9K', 'E8M3P', 'C2L7W', 'N4H6Y', 'J7M2A', 'O3S8C']
const ids = NAMES.map((_, i) => uid(2, i + 1))
const [ANA, BO, MADS, SOFIE, FREJA, LARS, IDA, EMIL, CLARA, NOAH, MAJA, OSCAR] = ids
/** The guest the phone fixtures are seen by. */
export const FIXTURE_PLAYER_ID = SOFIE

const QUIZ = uid(3, 1)
const ELIMINATION = uid(3, 2)
const FUSION = uid(3, 3)
const PONG = uid(3, 4)
const DARTS = uid(3, 5)
const SOUNDTRACK = uid(3, 6)

const PROFILES: Record<string, Player['profile']> = {
  [BO]: { elimination: { tags: 3, wins: 1 } },
  [ANA]: { elimination: { catches: 1 }, quiz: { wins: 1 } },
  [MAJA]: { fusion: { detective: 1 } },
}

const PLAYERS: Player[] = NAMES.map((name, i) => ({
  id: ids[i],
  name,
  code: CODES[i],
  profile: PROFILES[ids[i]] ?? {},
  created_at: FIXTURE_NOW - (110 - i * 4) * MIN,
  joined_at: FIXTURE_NOW - (110 - i * 4) * MIN,
}))

/**
 * The host's guest list (docs/guest-list.md, 11.1): the twelve players as
 * joined, and the four the host listed before the party who haven't joined
 * yet, by name as the database sorts it. Only the host page reads it.
 */
/** The four guests the host listed who haven't joined, in the order they were added. */
const EXPECTED_GUESTS: ListedGuest[] = FIXTURE_EXPECTED_NAMES.map((name, i) => ({
  id: uid(2, NAMES.length + i + 1),
  name,
  joined_at: null,
  created_at: FIXTURE_NOW - (170 - i) * MIN,
}))

/** The guest list of a scene with these players: them as joined, and the four still expected. */
const guestsOf = (players: Player[]): ListedGuest[] =>
  [...players.map((p) => ({ id: p.id, name: p.name, joined_at: p.joined_at!, created_at: p.created_at })), ...EXPECTED_GUESTS].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

const BASE_SESSION: Session = {
  id: FIXTURE_SESSION_ID,
  name: 'Birthday party',
  join_code: 'HURRA30',
  status: 'open',
  data: {},
  spotlight_game_id: null,
  spotlight_at: null,
  tv_scene: 'live',
  sound_volume: 100,
  archived_at: null,
  created_at: FIXTURE_NOW - 3 * 60 * MIN,
}

function game(id: string, game_type: string, title: string, position: number, patch: Partial<SessionGame> = {}): SessionGame {
  return {
    id,
    game_type,
    title,
    position,
    status: 'pending',
    public_state: null,
    started_at: null,
    finished_at: null,
    finished_by: null,
    winners: [],
    wake_at: null,
    archived_at: null,
    created_at: BASE_SESSION.created_at + position * MIN,
    ...patch,
  }
}

const rankOf = (points: Record<string, number>, id: string) =>
  1 + Object.values(points).filter((p) => p > (points[id] ?? 0)).length

const nameOfPlayer = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? 'Someone'

/** The players with the most points, all tied ones; none when nobody scored. */
function topOf(points: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(points))
  return best > 0 ? ids.filter((id) => points[id] === best) : []
}

// Last one standing (8.1) -----------------------------------------------------------------

const TASKS = [
  'Get someone to sing a line from a song',
  'Get someone to give you a high five',
  'Get someone to hum a tune',
  'Get someone to tell you their star sign',
  'Get someone to do a little dance',
  'Get someone to take a selfie with you',
  'Get someone to say the word ‘banana’',
  'Get someone to clink glasses with you',
  'Get someone to tell you a joke',
  'Get someone to whistle',
  'Get someone to pull a funny face',
  'Get someone to snap their fingers',
]

/** The rest of the shuffled deck, never dealt yet: a latecomer gets the next one. */
const MORE_TASKS = [
  'Get someone to play air guitar',
  'Get someone to name three vegetables',
  'Get someone to freeze like a statue',
  'Get someone to recommend you a book',
]

type Knockout = { by: string; target: string; method: 'tag' | 'catch'; task: string; at: number }

/**
 * A round played through the given knockouts ([by, target, method] as player
 * numbers), spread evenly from `startedAt` to the last one at `lastAt`, with
 * what each audience sees. `late` are dealt in after the start, at the end of
 * the deal order, with the next cards of the deck. Dealing in closes by itself
 * 105 minutes after the start.
 */
function eliminationRound(moves: [number, number, 'tag' | 'catch'][], startedAt: number, lastAt: number, late: string[] = []) {
  const tasks: Record<string, string> = Object.fromEntries(ids.map((id, i) => [id, TASKS[i]]))
  const playerIds = [...ids.filter((id) => !late.includes(id)), ...late]
  const deck = [...playerIds.map((id) => tasks[id]), ...MORE_TASKS]
  const dealInUntil = startedAt + 105 * MIN
  const knockouts: Knockout[] = []
  moves.forEach(([by, target, method], k) => {
    const byId = ids[by]
    const targetId = ids[target]
    const at = Math.round(startedAt + ((k + 1) * (lastAt - startedAt)) / moves.length)
    if (method === 'tag') {
      knockouts.push({ by: byId, target: targetId, method, task: tasks[byId], at })
      tasks[byId] = tasks[targetId]
    } else {
      knockouts.push({ by: byId, target: targetId, method, task: tasks[targetId], at })
    }
    delete tasks[targetId]
  })
  const alive = ids.filter((id) => id in tasks)
  const winner = alive.length === 1 ? alive[0] : null
  const counts: Record<string, number> = {}
  for (const k of knockouts) counts[k.by] = (counts[k.by] ?? 0) + 1
  const held = new Set(Object.values(tasks))
  const publicState = {
    alive,
    out: knockouts.map((k) => k.target),
    winner,
    outBy: Object.fromEntries(knockouts.map((k) => [k.target, { by: k.by, method: k.method }])),
    knockoutCounts: counts,
    feed: [...knockouts].reverse().map((k) => ({ ...k, task: held.has(k.task) ? null : k.task })),
    dealIn: FIXTURE_NOW < dealInUntil,
    dealInUntil,
  }
  const views: Record<string, unknown> = {}
  for (const id of ids) {
    const knockout = knockouts.find((k) => k.target === id)
    views[id] =
      id === winner
        ? { status: 'winner', knockouts: counts[id] ?? 0 }
        : knockout
          ? { status: 'out', by: knockout.by, method: knockout.method, task: knockout.task, knockouts: counts[id] ?? 0 }
          : { status: 'alive', task: tasks[id], knockouts: counts[id] ?? 0, ...(late.includes(id) ? { late: true } : {}) }
  }
  return {
    state: {
      tasks,
      playerIds,
      knockouts,
      deck,
      dealt: playerIds.length,
      dealIn: true,
      dealInUntil,
      ...(late.length > 0 ? { late } : {}),
    },
    config: { tasks: [...TASKS, ...MORE_TASKS], pointsPerTag: 1, pointsPerCatch: 1, dealInMinutes: 105 },
    publicState,
    views,
    points: counts,
    knockouts,
  }
}

const ELIMINATION_STARTED = FIXTURE_NOW - 50 * MIN
/** Still running: 4 out, 8 standing. With `late`, those guests were dealt in after the start. */
const eliminationLive = (late: string[] = []) =>
  eliminationRound(
    [
      [1, 5, 'tag'],
      [0, 7, 'catch'],
      [1, 8, 'tag'],
      [2, 11, 'tag'],
    ],
    ELIMINATION_STARTED,
    FIXTURE_NOW - 4 * MIN,
    late,
  )
/** When Sofie joined and was dealt in, in the latecomer scene. */
const SOFIE_JOINED = FIXTURE_NOW - 12 * MIN
/** Played to the end: Bo is the last one standing. Sofie was tagged by Bo. */
const eliminationDone = (startedAt: number, finishedAt: number) =>
  eliminationRound(
    [
      [1, 5, 'tag'],
      [0, 7, 'catch'],
      [1, 8, 'tag'],
      [2, 11, 'tag'],
      [4, 9, 'catch'],
      [6, 10, 'tag'],
      [1, 3, 'tag'],
      [0, 6, 'tag'],
      [2, 4, 'catch'],
      [1, 2, 'tag'],
      [1, 0, 'tag'],
    ],
    startedAt,
    finishedAt,
  )

// The quiz (8.3) ----------------------------------------------------------------------------

const QUESTIONS = [
  { text: 'Which planet is known as the red planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1 },
  { text: 'How many legs does a spider have?', options: ['Six', 'Eight', 'Ten'], correct: 1 },
  { text: 'What is the capital of Denmark?', options: ['Aarhus', 'Odense', 'Copenhagen', 'Aalborg'], correct: 2 },
  { text: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correct: 2 },
  { text: 'What do bees make?', options: ['Honey', 'Milk', 'Silk'], correct: 0 },
  { text: 'How many minutes are in a day?', options: ['1,440', '1,240', '960', '2,400'], correct: 0 },
  { text: 'Which instrument has 88 keys?', options: ['Organ', 'Piano', 'Accordion', 'Harp'], correct: 1 },
  { text: 'What colour is a polar bear’s skin?', options: ['White', 'Pink', 'Black', 'Grey'], correct: 2 },
  { text: 'Which country gave the world LEGO?', options: ['Sweden', 'Germany', 'Denmark', 'Norway'], correct: 2 },
  { text: 'What is the hardest natural material?', options: ['Gold', 'Iron', 'Quartz', 'Diamond'], correct: 3 },
]
const QUIZ_SECONDS = 20
const GRACE_MS = 1000
const REVEAL_HOLD_MS = 7000
const quizConfig = { questions: QUESTIONS, seconds: QUIZ_SECONDS, pointsPerRight: 1 }
/** Each guest's [choice, ms] per question, by player number; null for no answer. */
const QUIZ_ANSWERS: ([number, number] | null)[][] = [
  [[1, 3200], [1, 5400], [0, 7000], [1, 4100], [1, 9800], [2, 12000], [1, 6100], null, [1, 2500], [3, 15000], [1, 8800], [1, 11000]],
  [[1, 4000], [0, 6000], [1, 3000], [1, 5200], [2, 7000], [1, 9000], [1, 12000], [1, 4800], [0, 10000], [1, 6600], null, [2, 14000]],
  [[2, 2900], [2, 6100], [0, 4500], [2, 3800], [1, 8000], [2, 10400], [3, 9000], [2, 12500], [0, 7700], [1, 5000], [2, 13900], null],
]
const quizPointsFor = (ms: number) => Math.round(1000 * (1 - Math.min(1, ms / (QUIZ_SECONDS * 1000)) / 2))
const QUIZ_STARTED = FIXTURE_NOW - 6 * MIN
/** Questions open a minute apart, the current one so its countdown, reveal or leaderboard is happening now. */
const QUESTION_GAP_MS = 60_000

function quizResult(index: number) {
  const { correct, options } = QUESTIONS[index]
  const counts = options.map(() => 0)
  const answers: Record<string, { choice: number; ms: number; points: number }> = {}
  QUIZ_ANSWERS[index].forEach((answer, i) => {
    if (!answer) return
    const [choice, ms] = answer
    counts[choice]++
    answers[ids[i]] = { choice, ms, points: choice === correct ? quizPointsFor(ms) : 0 }
  })
  return { index, correct, counts, answers }
}

/**
 * The quiz at question `index` in `phase`, earlier questions scored. While a
 * question is open, guests with an even player number have answered it, plus
 * Sofie when `meAnswered`.
 */
function quizRound(phase: 'question' | 'reveal' | 'leaderboard', index: number, meAnswered = false) {
  const revealed = phase === 'question' ? index : index + 1
  const answeredNow = (n: number) => n % 2 === 0 || (meAnswered && ids[n] === SOFIE)
  // The current question: counting down, revealed 2 s ago, or revealed 9 s ago (the leaderboard).
  const currentOpenedAt =
    phase === 'question' ? FIXTURE_NOW - 8000 : FIXTURE_NOW - (phase === 'reveal' ? 2000 : 9000) - QUIZ_SECONDS * 1000 - GRACE_MS
  const questionOpenedAt = (i: number) => currentOpenedAt - (index - i) * QUESTION_GAP_MS
  const results = Array.from({ length: revealed }, (_, i) => quizResult(i))
  const quizPoints: Record<string, number> = {}
  const right: Record<string, number> = {}
  for (const r of results) {
    for (const [id, a] of Object.entries(r.answers)) {
      quizPoints[id] = (quizPoints[id] ?? 0) + a.points
      if (a.points > 0) right[id] = (right[id] ?? 0) + 1
    }
  }
  const openedAt = questionOpenedAt(index)
  const endsAt = openedAt + QUIZ_SECONDS * 1000
  const revealedAt = phase === 'question' ? null : endsAt + GRACE_MS
  const latest = results[results.length - 1]
  const leaderboard = Object.entries(quizPoints)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([playerId, points]) => ({ playerId, points, gained: latest?.answers[playerId]?.points ?? 0, rank: rankOf(quizPoints, playerId) }))
  const current = results.find((r) => r.index === index)
  const fastest = current
    ? Object.entries(current.answers)
        .filter(([, a]) => a.points > 0)
        .sort((a, b) => a[1].ms - b[1].ms)
        .slice(0, 3)
        .map(([playerId, a]) => ({ playerId, ms: a.ms }))
    : []
  const q = QUESTIONS[index]
  const publicState = {
    phase,
    index,
    total: QUESTIONS.length,
    question: { key: `q${index + 1}`, text: q.text, options: q.options, endsAt },
    reveal: current
      ? {
          correct: current.correct,
          counts: current.counts,
          answered: Object.keys(current.answers).length,
          rightCount: Object.values(current.answers).filter((a) => a.points > 0).length,
          fastest,
        }
      : null,
    leaderboard,
  }
  const views: Record<string, unknown> = {}
  for (const id of ids) {
    const last = latest ? { index: latest.index, choice: latest.answers[id]?.choice ?? null, correct: latest.correct, points: latest.answers[id]?.points ?? 0 } : null
    views[id] = { quizPoints: quizPoints[id] ?? 0, rank: rankOf(quizPoints, id), right: right[id] ?? 0, last }
  }
  const state = { phase, index, openedAt, endsAt, revealedAt, results, quizPoints, right }
  const prompts: PromptState[] = Array.from({ length: index + 1 }, (_, i) => {
    const opened = questionOpenedAt(i)
    const closesAt = i === index ? endsAt + GRACE_MS : opened + QUIZ_SECONDS * 1000 + GRACE_MS
    const isRevealed = i < revealed
    return {
      game_id: QUIZ,
      key: `q${i + 1}`,
      spec: { kind: 'choice', options: QUESTIONS[i].options.map((_, n) => String(n)), final: true },
      opened_at: opened,
      closes_at: closesAt,
      closed_at: isRevealed ? (i === index ? (revealedAt ?? closesAt) : closesAt) : null,
      revealed_at: isRevealed ? (i === index ? revealedAt : closesAt) : null,
    }
  })
  // Answers so far to the open question (counts only: no answer leaves the database before the reveal).
  const tallies: Record<string, number> =
    phase === 'question' ? { [`q${index + 1}`]: QUIZ_ANSWERS[index].filter((a, n) => a && answeredNow(n)).length } : {}
  const answers: Record<string, Record<string, AnswerPayload>> = {}
  for (let i = 0; i <= index; i++) {
    QUIZ_ANSWERS[i].forEach((a, n) => {
      if (a && (i < index || phase !== 'question' || answeredNow(n))) {
        answers[ids[n]] = { ...answers[ids[n]], [`q${i + 1}`]: { choice: [String(a[0])] } }
      }
    })
  }
  const wakeAt = phase === 'question' ? endsAt + GRACE_MS : phase === 'reveal' ? (revealedAt ?? 0) + REVEAL_HOLD_MS : null
  return { state, publicState, views, points: right, prompts, tallies, answers, wakeAt }
}

// Participant fusion (8.4) --------------------------------------------------------------------

const PICTURE_KEY: [string, string][] = [
  [MADS, IDA],
  [FREJA, OSCAR],
  [ANA, NOAH],
  [BO, MAJA],
  [LARS, CLARA],
  [EMIL, SOFIE],
]
/** Each voter's guess per picture (by player number), sorted as the database stores choices. */
const FUSION_VOTES: Record<number, [number, number]>[] = [
  { 0: [2, 6], 1: [2, 9], 3: [2, 6], 4: [6, 7], 9: [2, 6], 10: [2, 6] },
  { 0: [4, 11], 3: [4, 10], 5: [4, 11], 6: [8, 11], 10: [4, 11] },
  { 1: [0, 9], 3: [0, 5], 4: [0, 9], 10: [0, 9] },
  { 0: [1, 10], 3: [1, 4], 10: [1, 10] },
  { 3: [5, 8], 10: [5, 8] },
  { 10: [3, 7] },
]
const sortedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
const FUSION_STARTED = FIXTURE_NOW - 80 * MIN
/** The background scene's round of darts, live beside the quiz since after Last one standing began. */
const DARTS_STARTED = FIXTURE_NOW - 30 * MIN

/**
 * A round of the background version as it saved it, voting closed (`locked`),
 * with the first `revealedCount` pictures revealed: a live one started before
 * the update (fusion-legacy) and a finished one (archived) are real old saves.
 */
function fusionRound(revealedCount: number) {
  const phase = 'locked'
  const revealed = Array.from({ length: revealedCount }, (_, i) => i + 1)
  const results: Record<string, { both: number; one: number; none: number; voters: number; hits: Record<string, number> }> = {}
  const totals: Record<string, number> = {}
  for (const n of revealed) {
    const people = PICTURE_KEY[n - 1]
    const hits: Record<string, number> = {}
    let both = 0
    let one = 0
    let none = 0
    let voters = 0
    for (const [voter, [a, b]] of Object.entries(FUSION_VOTES[n - 1])) {
      const voterId = ids[Number(voter)]
      if (people.includes(voterId)) continue
      voters++
      const hit = [ids[a], ids[b]].filter((id) => people.includes(id)).length
      hits[voterId] = hit
      if (hit === 2) both++
      else if (hit === 1) one++
      else none++
      totals[voterId] = (totals[voterId] ?? 0) + hit
    }
    results[n] = { both, one, none, voters, hits }
  }
  const lastReveal = revealedCount > 0 ? { n: revealedCount, at: FIXTURE_NOW - 1500 } : null
  const publicState = {
    phase,
    pictures: PICTURE_KEY.map((people, i) => {
      const n = i + 1
      const r = results[n]
      return {
        n,
        key: `p${n}`,
        label: `#${n}`,
        image: null,
        revealed: r ? { people: sortedPair(...people), both: r.both, one: r.one, none: r.none, voters: r.voters } : null,
      }
    }),
    top: Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([playerId, points]) => ({ playerId, points })),
    lastReveal,
  }
  const views: Record<string, unknown> = {}
  for (const id of ids) {
    const hits: Record<string, number> = {}
    for (const n of revealed) if (results[n].hits[id] !== undefined) hits[n] = results[n].hits[id]
    views[id] = { points: totals[id] ?? 0, hits }
  }
  const closedAt = FIXTURE_NOW - 2 * MIN
  const prompts: PromptState[] = PICTURE_KEY.map((_, i) => ({
    game_id: FUSION,
    key: `p${i + 1}`,
    spec: { kind: 'choice', options: 'players', min: 2, max: 2, exclude_self: true },
    opened_at: FUSION_STARTED,
    closes_at: null,
    closed_at: closedAt,
    revealed_at: i < revealedCount ? FIXTURE_NOW - (revealedCount - i) * 1500 : null,
  }))
  const tallies: Record<string, number> = {}
  PICTURE_KEY.forEach((_, i) => {
    if (i >= revealedCount) tallies[`p${i + 1}`] = Object.keys(FUSION_VOTES[i]).length
  })
  const answers: Record<string, Record<string, AnswerPayload>> = {}
  FUSION_VOTES.forEach((votes, i) => {
    for (const [voter, [a, b]] of Object.entries(votes)) {
      const voterId = ids[Number(voter)]
      answers[voterId] = { ...answers[voterId], [`p${i + 1}`]: { choice: sortedPair(ids[a], ids[b]) } }
    }
  })
  const state = {
    phase,
    key: Object.fromEntries(PICTURE_KEY.map((people, i) => [String(i + 1), people])),
    revealed,
    results,
    totals,
    lastReveal,
  }
  const config = { pictures: PICTURE_KEY.map((people, i) => ({ label: `#${i + 1}`, people })), pointsPerPerson: 1 }
  return { state, config, publicState, views, points: totals, prompts, tallies, answers }
}

// Lydspor (.design/lydspor/spec.md) ---------------------------------------------------------------

/** A Lydspor scene's party: the sample round played through the real logic, beside a live Last one standing. */
function soundtrackWorld(scene: SoundtrackScene): World {
  const round = soundtrackSample(scene, { players: PLAYERS }, FIXTURE_NOW)
  const elimination = eliminationLive()
  const members = [...ids]
  const finished = round.finishedAt !== null
  const feed = round.announcements.map((a) =>
    say(a.message, a.at, {
      game_id: SOUNDTRACK,
      detail: a.detail ?? null,
      audience: a.to ?? null,
      sound: (a.sound ?? null) as FeedItem['sound'],
      icon: (a.icon ?? null) as FeedItem['icon'],
      tone: (a.tone ?? null) as FeedItem['tone'],
      interrupt: a.interrupt ?? false,
    }),
  )
  return {
    session: { spotlight_game_id: SOUNDTRACK, spotlight_at: round.startedAt },
    games: [
      game(ELIMINATION, 'elimination', 'Last one standing', 0, { status: 'active', public_state: elimination.publicState, started_at: ELIMINATION_STARTED }),
      game(QUIZ, 'quiz', 'Quiz', 1),
      game(SOUNDTRACK, 'soundtrack', 'Lydspor', 2, {
        status: finished ? 'finished' : 'active',
        public_state: round.publicState,
        started_at: round.startedAt,
        finished_at: round.finishedAt,
        finished_by: finished ? 'game' : null,
        winners: round.winners,
      }),
    ],
    prompts: round.prompts.map((p) => ({ game_id: SOUNDTRACK, ...p })),
    tallies: Object.keys(round.tallies).length > 0 ? { [SOUNDTRACK]: round.tallies } : {},
    points: { [ELIMINATION]: elimination.points, [SOUNDTRACK]: round.points },
    awards: AWARDS,
    views: { [ELIMINATION]: elimination.views, [SOUNDTRACK]: round.views },
    answers: { [SOUNDTRACK]: round.answers },
    states: {
      [ELIMINATION]: { state: elimination.state, config: elimination.config, round: 1, members },
      [SOUNDTRACK]: { state: round.state, config: round.config, round: 1, members },
    },
    feed: [
      say('Last one standing has started', ELIMINATION_STARTED, { game_id: ELIMINATION, detail: '12 players, one life each', icon: 'megaphone', sound: 'gong' }),
      ...feed,
    ],
  }
}

// Scenes --------------------------------------------------------------------------------------

/** One scene's party, before it is cut down to what a screen may read. */
type World = {
  session?: Partial<Session>
  games: SessionGame[]
  prompts?: PromptState[]
  tallies?: Tallies
  /** Every game's points this round, shown or not: the standings add them all up. */
  points?: Record<string, Record<string, number>>
  /** Host awards outside any game. */
  awards?: Record<string, number>
  views?: Record<string, Record<string, unknown>>
  answers?: Record<string, Record<string, Record<string, AnswerPayload>>>
  states?: Record<string, { state: unknown; config: unknown; round: number; members: string[] }>
  feed?: FeedItem[]
  recapAt?: number
  /** The players, when the scene changes when someone joined. */
  players?: Player[]
}

const AWARDS = { [CLARA]: 3, [BO]: 2 }
const PONG_POINTS = { [FREJA]: 7, [NOAH]: 4, [IDA]: 3 }

let feedId = 100
function say(
  message: string,
  at: number,
  options: Partial<Omit<FeedItem, 'id' | 'message' | 'created_at'>> = {},
): FeedItem {
  return {
    id: feedId++,
    game_id: null,
    message,
    detail: null,
    audience: null,
    sound: null,
    icon: null,
    tone: null,
    interrupt: false,
    created_at: at,
    ...options,
  }
}

const pong = (finishedAt: number) =>
  game(PONG, 'in-person', 'Beer pong', 3, {
    status: 'finished',
    public_state: {},
    started_at: finishedAt - 25 * MIN,
    finished_at: finishedAt,
    finished_by: 'host',
    winners: [FREJA],
  })

// Participant fusion on the stage (8.4) ------------------------------------------------------
// The round as the engine saves it, phase by phase: the full state and the
// settings (host page only), the public state, every guest's view, the
// prompts and their counts, and Sofie's own locks. Fusion holds the TV, and
// Last one standing runs in the background.

const STAGE_RULES = { seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 1 }
const STAGE_GRACE_MS = 1000
const STAGE_WAKE_MARGIN_MS = 250
const STAGE_REVEAL_HOLD_MS = 10_000
/** From one picture's reveal to the next one's: 10 s of reveal, a few on the wall, 30 s to guess. */
const STAGE_STEP_MS = 45_000
/** The 12 prints of the party: #4 is Bo and Maja, Sofie is in #6. */
const STAGE_KEY: [number, number][] = [
  [2, 6],
  [4, 11],
  [0, 9],
  [1, 10],
  [5, 8],
  [7, 3],
  [0, 5],
  [2, 8],
  [1, 9],
  [4, 6],
  [11, 7],
  [10, 0],
]
const SOFIE_AT = ids.indexOf(SOFIE)

/** Who is in picture n: the party's 12, then pairs of the 12 players cycling for more. */
function stagePair(n: number): [string, string] {
  if (n <= STAGE_KEY.length) {
    const [a, b] = STAGE_KEY[n - 1]
    return [ids[a], ids[b]]
  }
  const k = n - STAGE_KEY.length - 1
  const a = (k * 5 + 1) % ids.length
  return [ids[a], ids[(a + 1 + (k % 5)) % ids.length]]
}

/** Two other guests for a guess, in a fixed order from `start`, leaving out `skip`. */
function othersFor(start: number, skip: readonly string[]): string[] {
  return Array.from({ length: ids.length }, (_, i) => ids[(start + i) % ids.length]).filter((id) => !skip.includes(id))
}

/** How Sofie's lock on the picture being asked or revealed went: both, one or none of the two, or no lock. */
type SofieGuess = 0 | 1 | 2 | null

/**
 * Player v's locked guess on picture n, sorted as the database stores choices,
 * or null for no lock. Sofie got both on #1, one on #2, none on #3, and both on
 * the picture of the asking and reveal scenes (`sofie` for the reveal's other
 * outcomes); the others follow a pattern.
 */
function stageGuess(v: number, n: number, current: number | null, sofie: SofieGuess = 0): [string, string] | null {
  const people = stagePair(n)
  const me = ids[v]
  if (people.includes(me)) return null
  const kind =
    v === SOFIE_AT
      ? n === current
        ? sofie
        : n === 1
          ? 0
          : n === 2
            ? 1
            : n === 3
              ? 2
              : (v + 2 * n) % 3
      : (v + n) % 5 === 0
        ? null
        : (v + 2 * n) % 3
  if (kind === null) return null
  const others = othersFor(v + n, [...people, me])
  const pair: [string, string] = kind === 0 ? [people[0], people[1]] : kind === 1 ? [people[0], others[0]] : [others[0], others[1]]
  return sortedPair(...pair)
}

type StageKind =
  | 'lobby'
  | 'showing'
  | 'wall'
  | 'asking'
  | 'asking-locked'
  | 'asking-you'
  | 'reveal'
  | 'reveal-one'
  | 'reveal-none'
  | 'reveal-missed'
  | 'reveal-you'
  | 'reveal-plain'
  | 'crown'
  | 'final'

/** fusion-asking-40 as its kind and its number of pictures. */
function stageOf(scene: FusionStageScene): { kind: StageKind; count: number } {
  const match = /^fusion-(.+?)(?:-(2|40))?$/.exec(scene)!
  return { kind: match[1] as StageKind, count: match[2] ? Number(match[2]) : 12 }
}

export const isFusionStageScene = (scene: string): scene is FusionStageScene => FUSION_STAGE_SCENES.includes(scene as FusionStageScene)

function fusionStage(scene: FusionStageScene) {
  const { kind, count } = stageOf(scene)
  const numbers = Array.from({ length: count }, (_, i) => i + 1)
  // In the lobby of the party's 12, the last two prints still wait for their people (Show who).
  const keyed = (n: number) => !(kind === 'lobby' && count === 12 && n > 10)
  const before = count === 2 ? 1 : count === 40 ? 15 : 3
  const phase: 'lobby' | 'showing' | 'wall' | 'asking' | 'reveal' | 'done' =
    kind === 'asking-locked' || kind === 'asking-you'
      ? 'asking'
      : kind.startsWith('reveal')
        ? 'reveal'
        : kind === 'crown'
          ? 'wall'
          : kind === 'final'
            ? 'done'
            : (kind as 'lobby' | 'showing' | 'wall' | 'asking')
  const current = phase === 'asking' || phase === 'reveal' ? (kind === 'asking-you' || kind === 'reveal-you' ? 6 : before + 1) : null
  // The reveal's other outcomes on Sofie's phone: one of the two, none, or no lock (#6 she is in herself).
  const sofie: SofieGuess = kind === 'reveal-one' ? 1 : kind === 'reveal-none' ? 2 : kind === 'reveal-missed' ? null : 0
  const revealed =
    kind === 'final' || kind === 'crown'
      ? numbers
      : phase === 'wall' || phase === 'asking'
        ? numbers.slice(0, before)
        : phase === 'reveal'
          ? [...numbers.slice(0, before), current!]
          : []

  // The clock: the current picture now, the ones before it a step apart.
  const finishedAt = FIXTURE_NOW - MIN
  const asked = current !== null ? FIXTURE_NOW - (phase === 'asking' ? 12_000 : 1500 + STAGE_GRACE_MS + STAGE_WAKE_MARGIN_MS + STAGE_RULES.seconds * 1000) : null
  const lastReveal =
    phase === 'reveal'
      ? FIXTURE_NOW - 1500
      : asked !== null
        ? asked - 13_000
        : kind === 'final'
          ? finishedAt - 12_000
          : FIXTURE_NOW - 20_000
  const revealedAt = (i: number) => lastReveal - (revealed.length - 1 - i) * STAGE_STEP_MS
  const timesOf = (i: number) => {
    const at = revealedAt(i)
    const endsAt = at - STAGE_GRACE_MS - STAGE_WAKE_MARGIN_MS
    return { openedAt: endsAt - STAGE_RULES.seconds * 1000, endsAt, at }
  }
  const showStartedAt =
    kind === 'showing' ? FIXTURE_NOW - (count === 2 ? 1.5 : 2.5) * STAGE_RULES.showSeconds * 1000 : null
  const firstAt = revealed.length > 0 ? timesOf(0).openedAt : (asked ?? FIXTURE_NOW)
  const startedAt =
    kind === 'lobby' ? FIXTURE_NOW - MIN : kind === 'showing' ? FIXTURE_NOW - 2 * MIN : Math.min(FIXTURE_NOW - 20 * MIN, firstAt - 2 * MIN)

  // The guesses and the points, picture by picture.
  type Result = { both: number; one: number; none: number; voters: number; hits: Record<string, number>; at: number }
  const results: Record<string, Result> = {}
  const totals: Record<string, number> = {}
  revealed.forEach((n, i) => {
    const people = stagePair(n)
    const result: Result = { both: 0, one: 0, none: 0, voters: 0, hits: {}, at: timesOf(i).at }
    ids.forEach((id, v) => {
      const guess = stageGuess(v, n, current, sofie)
      if (!guess) return
      const hit = guess.filter((g) => people.includes(g)).length
      result.hits[id] = hit
      result.voters++
      if (hit === 2) result.both++
      else if (hit === 1) result.one++
      else result.none++
      const points = hit * STAGE_RULES.perPerson + (hit === 2 ? STAGE_RULES.bothBonus : 0)
      if (points > 0) totals[id] = (totals[id] ?? 0) + points
    })
    results[n] = result
  })
  const scorers = ids.filter((id) => (totals[id] ?? 0) > 0).sort((a, b) => totals[b] - totals[a] || ids.indexOf(a) - ids.indexOf(b))
  const rankOfScorer = (id: string) => 1 + scorers.filter((other) => totals[other] > totals[id]).length

  const names: Record<string, string> = {}
  const key: Record<string, [string, string]> = {}
  for (const n of numbers) {
    if (!keyed(n)) continue
    key[n] = stagePair(n)
    for (const id of key[n]) names[id] = nameOfPlayer(id)
  }
  const label = (n: number) => (n === 9 ? 'The viking' : `#${n}`)
  // The two people's own photos, drawn in each one's half of the fused sample: both for every picture but #6 (only
  // the first person's, so the second shows their profile photo or token), and none at all in fusion-reveal-plain.
  const originals = (n: number): [string | null, string | null] | null =>
    kind === 'reveal-plain' ? null : [`fixture/original-${n}-1.jpg`, n === 6 ? null : `fixture/original-${n}-2.jpg`]
  const config = {
    pictures: numbers.map((n) => ({
      label: label(n),
      image: `fixture/fusion-${n}.jpg`,
      ...(keyed(n) ? { people: stagePair(n) } : {}),
      ...(originals(n) ? { originals: originals(n) } : {}),
    })),
    pointsPerPerson: STAGE_RULES.perPerson,
    bonusForBoth: STAGE_RULES.bothBonus,
    seconds: STAGE_RULES.seconds,
    showSeconds: STAGE_RULES.showSeconds,
  }

  const currentTimes =
    current === null
      ? null
      : phase === 'reveal'
        ? timesOf(revealed.length - 1)
        : { openedAt: asked!, endsAt: asked! + STAGE_RULES.seconds * 1000, at: null }
  const publicState = {
    phase,
    pictures: numbers.map((n) => {
      const i = revealed.indexOf(n)
      const r = results[n]
      const people = stagePair(n)
      return {
        n,
        key: `p${n}`,
        label: label(n),
        image: `fixture/fusion-${n}.jpg`,
        revealed:
          i >= 0
            ? {
                people,
                names: [nameOfPlayer(people[0]), nameOfPlayer(people[1])],
                both: r.both,
                one: r.one,
                none: r.none,
                voters: r.voters,
                // Secret until the picture is revealed, as the logic's publicState keeps them.
                originals: originals(n) ?? [null, null],
                step: i + 1,
                at: r.at,
              }
            : null,
      }
    }),
    rules: STAGE_RULES,
    showing: showStartedAt !== null ? { startedAt: showStartedAt, endsAt: showStartedAt + count * STAGE_RULES.showSeconds * 1000 } : null,
    current:
      current !== null && currentTimes
        ? {
            n: current,
            step: phase === 'asking' ? revealed.length + 1 : revealed.length,
            key: `p${current}`,
            openedAt: currentTimes.openedAt,
            endsAt: currentTimes.endsAt,
            revealedAt: phase === 'reveal' ? currentTimes.at : null,
          }
        : null,
    top: scorers.slice(0, 5).map((id) => ({ playerId: id, points: totals[id], rank: rankOfScorer(id) })),
    // The four on the guest list who haven't joined: the phone's picker lists them under "Not here yet".
    expected: EXPECTED_GUESTS.map((g) => ({ id: g.id, name: g.name })),
  }

  const inPicture = (id: string) => current !== null && stagePair(current).includes(id)
  const views: Record<string, unknown> = {}
  for (const id of ids) {
    const hits: Record<string, number> = {}
    for (const n of revealed) if (results[n].hits[id] !== undefined) hits[n] = results[n].hits[id]
    views[id] = { points: totals[id] ?? 0, rank: (totals[id] ?? 0) > 0 ? rankOfScorer(id) : null, hits, inPicture: inPicture(id) }
  }

  const state = {
    phase,
    key,
    names,
    revealed,
    results,
    totals,
    showStartedAt,
    current,
    openedAt: currentTimes?.openedAt ?? null,
    endsAt: currentTimes?.endsAt ?? null,
    revealedAt: phase === 'reveal' ? currentTimes!.at : null,
  }

  const spec = { kind: 'choice' as const, options: 'guests' as const, min: 2, max: 2, exclude_self: true, final: true }
  const promptsAsked = phase === 'asking' ? [...revealed, current!] : revealed
  const prompts: PromptState[] = promptsAsked.map((n) => {
    const i = revealed.indexOf(n)
    const t = i >= 0 ? timesOf(i) : currentTimes!
    return {
      game_id: FUSION,
      key: `p${n}`,
      spec,
      opened_at: t.openedAt,
      closes_at: t.endsAt + STAGE_GRACE_MS,
      closed_at: i >= 0 ? t.endsAt + STAGE_GRACE_MS : null,
      revealed_at: i >= 0 ? t.at : null,
    }
  })
  // Counts only for the picture being guessed: 7 have locked in, and Sofie too once she has.
  const tallies: Record<string, number> = phase === 'asking' ? { [`p${current}`]: kind === 'asking-locked' ? 8 : 7 } : {}
  const answers: Record<string, Record<string, AnswerPayload>> = {}
  ids.forEach((id, v) => {
    for (const n of revealed) {
      const guess = stageGuess(v, n, current, sofie)
      if (guess) answers[id] = { ...answers[id], [`p${n}`]: { choice: guess } }
    }
  })
  if (kind === 'asking-locked') answers[SOFIE] = { ...answers[SOFIE], [`p${current}`]: { choice: sortedPair(BO, MAJA) } }

  const wakeAt =
    phase === 'showing'
      ? publicState.showing!.endsAt
      : phase === 'asking'
        ? currentTimes!.endsAt + STAGE_GRACE_MS + STAGE_WAKE_MARGIN_MS
        : phase === 'reveal'
          ? currentTimes!.at! + STAGE_REVEAL_HOLD_MS
          : null
  return { kind, state, config, publicState, views, points: totals, prompts, tallies, answers, wakeAt, startedAt, finishedAt, winners: scorers.filter((id) => rankOfScorer(id) === 1) }
}

/** A scene of Participant fusion on the stage, with Last one standing live in the background. */
function fusionStageWorld(scene: FusionStageScene): World {
  const fusion = fusionStage(scene)
  const elimination = eliminationLive()
  const members = [...ids]
  const finished = fusion.kind === 'final'
  const latest = elimination.knockouts[elimination.knockouts.length - 1]
  const feed: FeedItem[] = [
    say('Last one standing has started', ELIMINATION_STARTED, { game_id: ELIMINATION, detail: '12 players, one life each', icon: 'megaphone', sound: 'gong' }),
    say(`${nameOfPlayer(latest.by)} got ${nameOfPlayer(latest.target)}`, latest.at, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
  ]
  if (finished) {
    const names = fusion.winners.map(nameOfPlayer)
    const points = fusion.points[fusion.winners[0]]
    const shared = names.length > 1
    feed.push(
      say(`${names.join(' and ')} ${shared ? 'have the sharpest eyes' : 'has the sharpest eye'}`, fusion.finishedAt, {
        game_id: FUSION,
        detail: `${points} points`,
        icon: 'crown',
        tone: 'gold',
        sound: 'fanfare',
        interrupt: true,
      }),
    )
    if (fusion.winners.includes(SOFIE)) {
      feed.push(say('You have the sharpest eye', fusion.finishedAt, { game_id: FUSION, audience: [SOFIE], icon: 'crown', tone: 'gold', sound: 'fanfare' }))
    }
  }
  return {
    session: { spotlight_game_id: FUSION, spotlight_at: fusion.startedAt },
    games: [
      game(ELIMINATION, 'elimination', 'Last one standing', 0, { status: 'active', public_state: elimination.publicState, started_at: ELIMINATION_STARTED }),
      game(QUIZ, 'quiz', 'Quiz', 1),
      game(FUSION, 'fusion', 'Who is fused?', 2, {
        status: finished ? 'finished' : 'active',
        public_state: fusion.publicState,
        started_at: fusion.startedAt,
        wake_at: fusion.wakeAt,
        ...(finished ? { finished_at: fusion.finishedAt, finished_by: 'game' as const, winners: fusion.winners } : {}),
      }),
      pong(FIXTURE_NOW - 75 * MIN),
    ],
    prompts: fusion.prompts,
    tallies: Object.keys(fusion.tallies).length > 0 ? { [FUSION]: fusion.tallies } : {},
    points: { [ELIMINATION]: elimination.points, [FUSION]: fusion.points, [PONG]: PONG_POINTS },
    awards: AWARDS,
    views: { [ELIMINATION]: elimination.views, [FUSION]: fusion.views },
    answers: { [FUSION]: fusion.answers },
    states: {
      [ELIMINATION]: { state: elimination.state, config: elimination.config, round: 1, members },
      [FUSION]: { state: fusion.state, config: fusion.config, round: 1, members },
    },
    feed: feed.sort((a, b) => a.created_at - b.created_at),
  }
}

function world(scene: Exclude<FixtureScene, 'removed'>): World {
  feedId = 100
  if (isFusionStageScene(scene)) return fusionStageWorld(scene)
  const members = [...ids]
  switch (scene) {
    case 'lobby':
      return {
        games: [game(ELIMINATION, 'elimination', 'Last one standing', 0), game(QUIZ, 'quiz', 'Quiz', 1), game(FUSION, 'fusion', 'Who is fused?', 2)],
        awards: AWARDS,
        feed: [say('Welcome to the party!', FIXTURE_NOW - 20 * MIN, { icon: 'confetti', tone: 'gold', sound: 'chime' })],
      }
    case 'quiz-question':
    case 'quiz-reveal':
    case 'quiz-leaderboard': {
      const phase = scene === 'quiz-question' ? 'question' : scene === 'quiz-reveal' ? 'reveal' : 'leaderboard'
      // In the question scene Sofie hasn't answered yet, so the phone shows the buttons.
      const quiz = quizRound(phase, 2)
      return {
        session: { spotlight_game_id: QUIZ, spotlight_at: QUIZ_STARTED },
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0),
          game(QUIZ, 'quiz', 'Quiz', 1, { status: 'active', public_state: quiz.publicState, started_at: QUIZ_STARTED, wake_at: quiz.wakeAt }),
          game(FUSION, 'fusion', 'Who is fused?', 2),
          pong(FIXTURE_NOW - 75 * MIN),
        ],
        prompts: quiz.prompts,
        tallies: phase === 'question' ? { [QUIZ]: quiz.tallies } : {},
        points: { [QUIZ]: quiz.points, [PONG]: PONG_POINTS },
        awards: AWARDS,
        views: { [QUIZ]: quiz.views },
        answers: { [QUIZ]: quiz.answers },
        states: { [QUIZ]: { state: quiz.state, config: quizConfig, round: 1, members } },
        feed: [
          say('Freja won Beer pong', FIXTURE_NOW - 75 * MIN, { game_id: PONG, icon: 'trophy', tone: 'gold', sound: 'fanfare' }),
          say('Quiz time!', QUIZ_STARTED, { game_id: QUIZ, detail: '10 questions. Answer on your phone.', icon: 'megaphone', sound: 'whoosh' }),
        ],
      }
    }
    // A live round of the background version, started before the update, on the
    // TV in its old shapes with two pictures revealed: every screen reads it as a
    // lobby that never starts, and the host room says to end and restart it.
    case 'fusion-legacy': {
      const fusion = fusionRound(2)
      const feed = [
        say('Who is fused? 6 pictures on the wall. Vote on your phone.', FUSION_STARTED, { game_id: FUSION, icon: 'detective', sound: 'chime' }),
        say('Voting is closed', FIXTURE_NOW - 2 * MIN, { game_id: FUSION, icon: 'megaphone', sound: 'ticktock' }),
      ]
      for (const picture of fusion.publicState.pictures) {
        if (!picture.revealed) continue
        const [a, b] = picture.revealed.people.map(nameOfPlayer)
        const { both, voters } = picture.revealed
        const at = FIXTURE_NOW - (fusion.state.revealed.length - picture.n + 1) * 1500
        feed.push(say(`${picture.label} was ${a} and ${b}!`, at, { game_id: FUSION, detail: `${both} of ${voters} got both`, icon: 'detective', sound: 'gotcha' }))
      }
      return {
        session: { spotlight_game_id: FUSION, spotlight_at: FIXTURE_NOW - 60_000 },
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0),
          game(QUIZ, 'quiz', 'Quiz', 1),
          game(FUSION, 'fusion', 'Who is fused?', 2, { status: 'active', public_state: fusion.publicState, started_at: FUSION_STARTED }),
        ],
        prompts: fusion.prompts,
        tallies: Object.keys(fusion.tallies).length > 0 ? { [FUSION]: fusion.tallies } : {},
        points: { [FUSION]: fusion.points },
        awards: AWARDS,
        views: { [FUSION]: fusion.views },
        answers: { [FUSION]: fusion.answers },
        states: { [FUSION]: { state: fusion.state, config: fusion.config, round: 1, members } },
        feed,
      }
    }
    case 'final': {
      const startedAt = FIXTURE_NOW - 70 * MIN
      const finishedAt = FIXTURE_NOW - 40_000
      const round = eliminationDone(startedAt, finishedAt)
      const sofieOut = round.knockouts.find((k) => k.target === SOFIE)?.at ?? startedAt
      return {
        session: { spotlight_game_id: ELIMINATION, spotlight_at: finishedAt },
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0, {
            status: 'finished',
            public_state: round.publicState,
            started_at: startedAt,
            finished_at: finishedAt,
            finished_by: 'game',
            winners: [BO],
          }),
          game(QUIZ, 'quiz', 'Quiz', 1),
          game(FUSION, 'fusion', 'Who is fused?', 2),
        ],
        points: { [ELIMINATION]: round.points },
        awards: AWARDS,
        views: { [ELIMINATION]: round.views },
        feed: [
          say('Bo got Sofie', sofieOut, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
          say("You're out!", sofieOut, { game_id: ELIMINATION, detail: 'Bo got you', audience: [SOFIE], icon: 'skull', tone: 'red', sound: 'sad' }),
          say('Bo got Ana', finishedAt, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
          say('Bo is the last one standing!', finishedAt, {
            game_id: ELIMINATION,
            detail: `${round.points[BO]} knockouts`,
            icon: 'crown',
            sound: 'fanfare',
            interrupt: true,
          }),
        ],
      }
    }
    case 'background': {
      // The quiz on the TV, with Last one standing and a round of darts live beside it.
      // Sofie has answered the open question here: the phone shows "Locked in".
      const quiz = quizRound('question', 2, true)
      const elimination = eliminationLive()
      const [firstOut] = elimination.knockouts
      const latest = elimination.knockouts[elimination.knockouts.length - 1]
      return {
        session: { spotlight_game_id: QUIZ, spotlight_at: QUIZ_STARTED },
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0, {
            status: 'active',
            public_state: elimination.publicState,
            started_at: ELIMINATION_STARTED,
          }),
          game(QUIZ, 'quiz', 'Quiz', 1, { status: 'active', public_state: quiz.publicState, started_at: QUIZ_STARTED, wake_at: quiz.wakeAt }),
          game(DARTS, 'in-person', 'Darts', 2, { status: 'active', public_state: {}, started_at: DARTS_STARTED }),
        ],
        prompts: quiz.prompts,
        tallies: { [QUIZ]: quiz.tallies },
        points: { [ELIMINATION]: elimination.points, [QUIZ]: quiz.points },
        awards: AWARDS,
        views: { [ELIMINATION]: elimination.views, [QUIZ]: quiz.views },
        answers: { [QUIZ]: quiz.answers },
        states: {
          [ELIMINATION]: { state: elimination.state, config: elimination.config, round: 1, members },
          [QUIZ]: { state: quiz.state, config: quizConfig, round: 1, members },
          [DARTS]: { state: {}, config: {}, round: 1, members },
        },
        feed: [
          say('Last one standing has started', ELIMINATION_STARTED, { game_id: ELIMINATION, detail: '12 players, one life each', icon: 'megaphone', sound: 'gong' }),
          say(`${nameOfPlayer(firstOut.by)} got ${nameOfPlayer(firstOut.target)}`, firstOut.at, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
          say('Quiz time!', QUIZ_STARTED, { game_id: QUIZ, detail: '10 questions. Answer on your phone.', icon: 'megaphone', sound: 'whoosh' }),
          say(`${nameOfPlayer(latest.by)} got ${nameOfPlayer(latest.target)}`, latest.at, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
        ].sort((a, b) => a.created_at - b.created_at),
      }
    }
    case 'latecomer': {
      // Nothing on the stage: the TV shows the standings with Last one standing in
      // the band, its count with Sofie in it. She joined after the start and got
      // the next card from the deck, so her phone says "You're in." over her task.
      const elimination = eliminationLive([SOFIE])
      const [firstOut] = elimination.knockouts
      const latest = elimination.knockouts[elimination.knockouts.length - 1]
      return {
        players: PLAYERS.map((p) => (p.id === SOFIE ? { ...p, created_at: SOFIE_JOINED, joined_at: SOFIE_JOINED } : p)),
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0, {
            status: 'active',
            public_state: elimination.publicState,
            started_at: ELIMINATION_STARTED,
          }),
          game(QUIZ, 'quiz', 'Quiz', 1),
          game(FUSION, 'fusion', 'Who is fused?', 2),
          pong(FIXTURE_NOW - 75 * MIN),
        ],
        points: { [ELIMINATION]: elimination.points, [PONG]: PONG_POINTS },
        awards: AWARDS,
        views: { [ELIMINATION]: elimination.views },
        states: { [ELIMINATION]: { state: elimination.state, config: elimination.config, round: 1, members } },
        feed: [
          say('Last one standing has started', ELIMINATION_STARTED, { game_id: ELIMINATION, detail: '11 players, one life each', icon: 'megaphone', sound: 'gong' }),
          say(`${nameOfPlayer(firstOut.by)} got ${nameOfPlayer(firstOut.target)}`, firstOut.at, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
          say("You're in Last one standing", SOFIE_JOINED, {
            game_id: ELIMINATION,
            detail: 'Your secret task is on your phone',
            audience: [SOFIE],
            icon: 'megaphone',
            sound: 'chime',
          }),
          say(`${nameOfPlayer(latest.by)} got ${nameOfPlayer(latest.target)}`, latest.at, { game_id: ELIMINATION, icon: 'sword', tone: 'pink', sound: 'slash' }),
        ].sort((a, b) => a.created_at - b.created_at),
      }
    }
    case 'soundtrack-lobby':
    case 'soundtrack-playing':
    case 'soundtrack-last-call':
    case 'soundtrack-locked':
    case 'soundtrack-reveal':
    case 'soundtrack-standings':
    case 'soundtrack-final':
      return soundtrackWorld(scene.slice('soundtrack-'.length) as SoundtrackScene)
    case 'archived': {
      const elimination = eliminationDone(FIXTURE_NOW - 150 * MIN, FIXTURE_NOW - 40 * MIN)
      const quiz = quizRound('leaderboard', 2)
      const fusion = fusionRound(6)
      const quizWinners = topOf(quiz.state.quizPoints)
      const fusionWinners = topOf(fusion.state.totals)
      return {
        session: { status: 'closed', archived_at: FIXTURE_NOW - 5 * MIN },
        games: [
          game(ELIMINATION, 'elimination', 'Last one standing', 0, {
            status: 'finished',
            public_state: elimination.publicState,
            started_at: FIXTURE_NOW - 150 * MIN,
            finished_at: FIXTURE_NOW - 40 * MIN,
            finished_by: 'game',
            winners: [BO],
          }),
          game(QUIZ, 'quiz', 'Quiz', 1, {
            status: 'finished',
            public_state: { ...quiz.publicState, phase: 'done' },
            started_at: FIXTURE_NOW - 70 * MIN,
            finished_at: FIXTURE_NOW - 30 * MIN,
            finished_by: 'host',
            winners: quizWinners,
          }),
          game(FUSION, 'fusion', 'Who is fused?', 2, {
            status: 'finished',
            public_state: { ...fusion.publicState, phase: 'done' },
            started_at: FUSION_STARTED,
            finished_at: FIXTURE_NOW - 12 * MIN,
            finished_by: 'game',
            winners: fusionWinners,
          }),
          pong(FIXTURE_NOW - 100 * MIN),
        ],
        points: { [ELIMINATION]: elimination.points, [QUIZ]: quiz.points, [FUSION]: fusion.points, [PONG]: PONG_POINTS },
        awards: AWARDS,
        views: { [ELIMINATION]: elimination.views, [QUIZ]: quiz.views, [FUSION]: fusion.views },
        feed: [
          say(`${fusionWinners.map(nameOfPlayer).join(' and ')} has the sharpest eye!`, FIXTURE_NOW - 12 * MIN, {
            game_id: FUSION,
            icon: 'crown',
            sound: 'fanfare',
            interrupt: true,
          }),
        ],
        recapAt: FIXTURE_NOW - 2 * MIN,
      }
    }
  }
}

/** Games whose public state, points and views a snapshot carries (2.7). */
function shownIds(session: Session, games: SessionGame[], now: number): Set<string> {
  const shown = new Set<string>()
  const finished = games.filter((g) => g.status === 'finished' && g.archived_at === null && g.finished_at !== null)
  const latest = finished.sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))[0]
  for (const g of games) {
    if (
      g.status === 'active' ||
      g.id === session.spotlight_game_id ||
      (g.status === 'finished' && g.finished_at !== null && g.finished_at > now - 60 * MIN) ||
      g.id === latest?.id
    ) {
      shown.add(g.id)
    }
  }
  return shown
}

/** A typed snapshot of that scene as the given screen reads it ('phone' as one guest, with `me`). */
export function fixtureSnapshot(scene: FixtureScene, screen: Screen): Snapshot {
  if (scene === 'removed') {
    return {
      now: FIXTURE_NOW,
      member: false,
      exists: true,
      session: null,
      games: [],
      prompts: [],
      tallies: {},
      game_points: {},
      players: [],
      standings: [],
      feed: [],
      me: null,
      states: null,
      screens: null,
      recap: null,
      guests: null,
    }
  }
  const w = world(scene)
  const session: Session = { ...BASE_SESSION, ...w.session }
  const shown = shownIds(session, w.games, FIXTURE_NOW)
  const active = new Set(w.games.filter((g) => g.status === 'active').map((g) => g.id))
  const games = w.games.map((g) => (shown.has(g.id) ? g : { ...g, public_state: null }))

  const totals: Record<string, number> = {}
  for (const points of [...Object.values(w.points ?? {}), w.awards ?? {}]) {
    for (const [id, value] of Object.entries(points)) totals[id] = (totals[id] ?? 0) + value
  }
  const standings = PLAYERS.map((p) => ({ player_id: p.id, name: p.name, code: p.code, points: totals[p.id] ?? 0, profile: p.profile })).sort(
    (a, b) => b.points - a.points || a.name.localeCompare(b.name),
  )
  const gamePoints: Record<string, Record<string, number>> = {}
  for (const [gameId, points] of Object.entries(w.points ?? {})) if (shown.has(gameId)) gamePoints[gameId] = points

  const phone = screen === 'phone'
  const feed = (w.feed ?? [])
    .filter((item) => item.audience === null || (phone && item.audience.includes(FIXTURE_PLAYER_ID)))
    .sort((a, b) => b.id - a.id)
    .slice(0, 12)

  const views: Record<string, unknown> = {}
  for (const [gameId, byPlayer] of Object.entries(w.views ?? {})) {
    if (shown.has(gameId) && byPlayer[FIXTURE_PLAYER_ID] !== undefined) views[gameId] = byPlayer[FIXTURE_PLAYER_ID]
  }
  const answers: Record<string, Record<string, AnswerPayload>> = {}
  for (const [gameId, byPlayer] of Object.entries(w.answers ?? {})) {
    if (active.has(gameId) && byPlayer[FIXTURE_PLAYER_ID]) answers[gameId] = byPlayer[FIXTURE_PLAYER_ID]
  }
  const states: NonNullable<Snapshot['states']> = {}
  for (const [gameId, state] of Object.entries(w.states ?? {})) if (active.has(gameId)) states[gameId] = state

  return {
    now: FIXTURE_NOW,
    member: true,
    exists: true,
    session,
    games,
    prompts: (w.prompts ?? []).filter((p) => active.has(p.game_id)),
    tallies: w.tallies ?? {},
    game_points: gamePoints,
    players: w.players ?? PLAYERS,
    standings,
    feed,
    me: phone ? { player_id: FIXTURE_PLAYER_ID, views, answers } : null,
    states: screen === 'host' ? states : null,
    screens: screen === 'host' ? 1 : null,
    recap: w.recapAt ? { published_at: w.recapAt } : null,
    guests: screen === 'host' ? guestsOf(w.players ?? PLAYERS) : null,
  }
}

/** The recap published in the 'archived' scene, for the TV's recap scene and the phone's "Your night". */
export function fixtureRecapDoc(): RecapDoc {
  const snapshot = fixtureSnapshot('archived', 'tv')
  const points = world('archived').points ?? {}
  let rank = 0
  const standings = snapshot.standings.map((row, i, rows) => {
    if (i === 0 || row.points !== rows[i - 1].points) rank = i + 1
    return { playerId: row.player_id, name: row.name, points: row.points, rank }
  })
  const top = standings.slice(0, 8)
  const start = FIXTURE_NOW - 110 * MIN
  const race = Array.from({ length: 12 }, (_, i) => ({
    at: start + i * 10 * MIN,
    totals: Object.fromEntries(top.map((r) => [r.playerId, Math.round((r.points * i) / 11)])),
  }))
  const chapters: RecapDoc['chapters'] = snapshot.games.map((g) => ({
    gameId: g.id,
    gameType: g.game_type,
    title: g.title,
    round: 1,
    startedAt: g.started_at ?? start,
    finishedAt: g.finished_at,
    finishedBy: g.finished_by,
    winners: g.winners.map((id) => ({ id, name: nameOfPlayer(id) })),
    highlights: [
      { title: `${g.winners.map(nameOfPlayer).join(' and ')} won ${g.title}`, players: g.winners, icon: 'crown', weight: 'headline' },
    ],
  }))
  chapters[0].highlights.push(
    { title: 'Top hunter: Bo', detail: `${points[ELIMINATION]?.[BO] ?? 0} knockouts`, players: [BO], icon: 'sword', weight: 'highlight' },
    { title: 'First out: Lars', detail: '10 minutes in, tagged by Bo', players: [LARS, BO], weight: 'line' },
  )
  chapters[1].highlights.push({ title: 'Fastest right answer: Clara', detail: '2.5 s on question 1', players: [CLARA], icon: 'lightning', weight: 'highlight' })
  return {
    version: 1,
    session: { id: FIXTURE_SESSION_ID, name: BASE_SESSION.name },
    generatedAt: FIXTURE_NOW - 2 * MIN,
    numbers: { guests: PLAYERS.length, games: chapters.length, answers: 34, moves: 11, awards: 5 },
    chapters,
    race,
    leadChanges: [
      { at: start + 40 * MIN, playerId: FREJA, name: 'Freja' },
      { at: start + 85 * MIN, playerId: BO, name: 'Bo' },
    ],
    podium: standings.filter((r) => r.points > 0).slice(0, 3).map(({ playerId, name, points }) => ({ playerId, name, points })),
    standings,
    players: Object.fromEntries(
      standings.map((r) => [
        r.playerId,
        {
          name: r.name,
          rank: r.rank,
          points: r.points,
          byGame: chapters
            .flatMap((c) => {
              const value = points[c.gameId]?.[r.playerId] ?? 0
              return value ? [{ gameId: c.gameId, title: c.title, points: value }] : []
            })
            .sort((a, b) => b.points - a.points),
          moments: chapters.flatMap((c) => c.highlights.filter((h) => h.players?.includes(r.playerId))),
        },
      ]),
    ),
    timeline: chapters.flatMap((c) => [
      { at: c.startedAt, text: `${c.title} started`, icon: 'megaphone' as const, gameId: c.gameId },
      ...(c.finishedAt ? [{ at: c.finishedAt, text: c.highlights[0].title, icon: 'crown' as const, gameId: c.gameId }] : []),
    ]).sort((a, b) => a.at - b.at),
  }
}
