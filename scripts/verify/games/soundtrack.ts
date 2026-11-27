// Lydspor's oracle: per revealed song, the event's points for the right photo
// (a photo on two of a guest's songs at the lock scores on neither), the
// title's and the singer's for a typed answer that counts (exactly, with a
// forgiven typo, or a near miss the host accepted); only guests here who
// answered anything and don't sit out (by name) score; nothing reaches the
// board until the crown, which pays round(points x boardMax / most). The
// typed answers come from this file with what they are meant to be (right,
// a typo, a near miss of each kind, wrong), so the oracle knows how each must
// be judged without the game's matcher; the host's review rows only say which
// guests typed the same thing. The titles, singers and each song's photo are
// the secrets until its reveal, every typed answer always.
import { botSight, hostBotSight } from '../../../src/games/core/contract'
import type { AnswerPayload, PlayerId } from '../../../src/games/core/Game'
import type { Step } from '../../../src/games/core/runtime'
import { BOT_SONGS } from '../../../src/games/soundtrack/bot'
import type {
  ReviewRow,
  SoundtrackConfig,
  SoundtrackPlayerView,
  SoundtrackPublicState,
  SoundtrackState,
  TypedPart,
} from '../../../src/games/soundtrack/types'
import {
  competitionRank,
  fold,
  sameScores,
  sameSet,
  show,
  stringsIn,
  tidyName,
  type Adapter,
  type Call,
  type HostStep,
  type Membership,
  type Move,
  type Oracle,
  type Run,
  type Snapshot,
} from '../core'

/** Invented songs: the bot's eight and four more. Titles and singers far apart, so a near miss is what it is meant to be. */
const SONGS: { title: string; singer: string; alsoTitle?: string; alsoSinger?: string; caption: string }[] = [
  ...BOT_SONGS.map((s) => ({ title: s.title, singer: s.singer, alsoTitle: s.alsoTitle, alsoSinger: s.alsoSinger, caption: s.caption })),
  { title: 'Velvet Morning Tide', singer: 'Ingrid Sol', caption: 'Sunrise swim, 2015' },
  { title: 'Northern Kites', singer: 'Hamid Rask', alsoTitle: 'Kites', caption: 'Beach day, 2010' },
  { title: 'Lemon Tree Parade', singer: 'The Brass Owls', alsoSinger: 'Brass Owls', caption: 'Graduation, 2013' },
  { title: 'Silver Bicycle', singer: 'Emma Fjeld', alsoSinger: 'Emma', caption: 'First bike, 2001' },
]

/** What a typed answer is meant to be. `counts` scores by itself; `close` and `wrong` only when the host accepts. */
type Intent = 'exact' | 'typo' | 'close' | 'wrong' | 'unknown'

/** English number words, which the matcher reads as digits. */
const NUMBER_WORD = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/i

/** Letters common titles don't use, for wrong answers far from everything (and unique per guest, to catch a leak). */
const ODD = 'qzxjwvk'

export const soundtrack: Adapter = {
  type: 'soundtrack',
  settings(run) {
    const { rng } = run
    const count = rng.between(1, run.size >= 24 ? 6 : 8)
    const picked = rng.shuffle(SONGS.map((_, i) => i)).slice(0, count)
    const extras = count >= 3 ? rng.between(2, 4) : rng.between(0, 4)
    const people = [...run.present(), ...run.expected()]
    const sitOut: string[] = []
    for (const p of people) if (rng.chance(0.12)) sitOut.push(rng.chance(0.1) ? p.id : spelling(p.name, run))
    if (rng.chance(0.3)) sitOut.push('Ingen Med Det Navn')
    return {
      songs: picked.map((k, i) => {
        const song = SONGS[k]
        return {
          title: song.title,
          singer: song.singer,
          alsoTitles: song.alsoTitle ? [song.alsoTitle] : [],
          alsoSingers: song.alsoSinger ? [song.alsoSinger] : [],
          photo: `verify/lydspor/s${run.seed}/song-${i + 1}.jpg`,
          caption: song.caption,
          startAt: rng.between(0, 200),
          note: `Verifier note ${i + 1}: the story behind ${song.title}`,
        }
      }),
      extraPhotos: Array.from({ length: extras }, (_, k) => ({ photo: `verify/lydspor/s${run.seed}/extra-${k + 1}.jpg`, caption: `Extra photo ${k + 1}` })),
      points: { event: rng.between(0, 5), title: rng.between(0, 5), singer: rng.between(0, 5) },
      lastCallSeconds: rng.between(20, 90),
      standingsEvery: rng.between(0, 5),
      hints: rng.chance(0.3),
      boardMax: rng.between(1, 25),
      intro: 'A verifier round',
      storyteller: 'The host',
      sitOut,
    }
  },
  begin: (run) => new SoundtrackOracle(run),
}

/** A name as someone might type it on the sit out list. */
function spelling(name: string, run: Run) {
  const r = run.rng.next()
  return r < 0.5 ? name : r < 0.75 ? name.toLowerCase() : name.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

type Picks = { event: (number | null)[]; title: (string | null)[]; singer: (string | null)[] }

class SoundtrackOracle implements Oracle {
  private readonly config: SoundtrackConfig
  /** Latest answer per prompt key and guest, until the lock. */
  private readonly answers = new Map<string, Map<PlayerId, AnswerPayload>>()
  /** What each typed text was meant to be, by guest, key and text. */
  private readonly intents = new Map<string, Intent>()
  /** Read at the lock, as the game reads it: every guest here with any answer. */
  private picks: Map<PlayerId, Picks> | null = null
  private sitOut: string[]
  /** The host's accepts, by song index, part and row key. */
  private readonly accepted = new Map<string, boolean>()
  private shownTop = new Map<PlayerId, number>()
  private readonly skill = new Map<PlayerId, number>()
  private counter = 0

  private readonly run: Run

  constructor(run: Run) {
    this.run = run
    this.config = run.config<SoundtrackConfig>()
    this.sitOut = this.namesOf(this.config.sitOut)
    const state = run.state<SoundtrackState>()
    if (!sameSet(state.sitOut.map(fold), this.sitOut.map(fold))) run.fail('scores-match-oracle', 'the start read the sit out list differently')
    const size = this.config.songs.length + this.config.extraPhotos.length
    if (!sameSet(state.wall.map(String), Array.from({ length: size }, (_, i) => String(i)))) run.fail('scores-match-oracle', 'the wall is not every photo once')
  }

  /** A sit out list as names: an id is its guest's name; an id on no list is dropped; each name once. */
  private namesOf(values: readonly string[]): string[] {
    const guests = [...this.run.present(), ...this.run.expected()]
    const out: string[] = []
    for (const value of values) {
      const known = guests.find((g) => g.id === value)
      const name = tidyName(known ? known.name : value)
      if (!known && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue
      if (fold(name) === '' || out.some((n) => fold(n) === fold(name))) continue
      out.push(name)
    }
    return out
  }

  private sittingOut(id: PlayerId) {
    const name = this.run.present().find((p) => p.id === id)?.name
    return name !== undefined && this.sitOut.some((n) => fold(n) === fold(name))
  }

  private skillOf(id: PlayerId) {
    if (!this.skill.has(id)) this.skill.set(id, this.run.rng.next())
    return this.skill.get(id)!
  }

  // Moves ---------------------------------------------------------------------

  guest(playerId: PlayerId): Move | null {
    const { run } = this
    const move = run.bot.move(botSight(run.party, run.gameId, playerId, run.rng.fn()))
    if (!move || move.kind !== 'answer') return move
    const [, n, part] = /^s(\d+)\.(title|singer|event)$/.exec(move.key) ?? []
    const i = Number(n) - 1
    const song = this.config.songs[i]
    if (!song) return move
    if (part === 'event') {
      // Some guests know where the photo is.
      if (run.rng.chance(this.skillOf(playerId) * 0.7)) {
        const wall = run.state<SoundtrackState>().wall
        return { kind: 'answer', key: move.key, answer: { choice: [String(wall.indexOf(i))] }, note: 'the right photo' }
      }
      return move
    }
    if (run.rng.chance(0.08)) {
      this.intents.set(this.intentKey(playerId, move.key, (move.answer as { text: string }).text), 'unknown')
      return { ...move, note: "the bot's own typing" }
    }
    const { text, intent } = this.typed(i, part as TypedPart, playerId)
    this.intents.set(this.intentKey(playerId, move.key, text), intent)
    return { kind: 'answer', key: move.key, answer: { text }, note: intent }
  }

  private intentKey(playerId: PlayerId, key: string, text: string) {
    return `${playerId}#${this.run.epoch(playerId)}|${key}|${text.trim()}`
  }

  /** A typed answer to one part of song i, and what the rules must make of it. */
  private typed(i: number, part: TypedPart, playerId: PlayerId): { text: string; intent: Intent } {
    const { rng } = this.run
    const song = this.config.songs[i]
    const truth = part === 'title' ? song.title : song.singer
    const other = part === 'title' ? song.singer : song.title
    const also = part === 'title' ? song.alsoTitles : song.alsoSingers
    const skill = this.skillOf(playerId)
    const roll = rng.next()
    if (roll < skill * 0.6) {
      const base = also.length > 0 && rng.chance(0.25) ? also[0] : truth
      const r = rng.next()
      if (r < 0.25) return { text: base.toLowerCase(), intent: 'exact' }
      if (r < 0.4) return { text: `  ${base.toUpperCase()}!`, intent: 'exact' }
      if (r < 0.5 && part === 'singer' && base.split(' ').length === 2 && !/feat/i.test(base)) {
        return { text: base.split(' ').reverse().join(' '), intent: 'exact' }
      }
      return { text: base, intent: 'exact' }
    }
    if (roll < skill * 0.85) {
      // Spec 5.2 folds aa, ae and oe before it counts letters, so a slip that makes or breaks one is two letters off: not a typo.
      const slip = swapInside(truth, rng.int(1000))
      if (slip && keyLength(truth) >= 5 && !digraphs(slip) && !digraphs(truth)) return { text: slip, intent: 'typo' }
    }
    if (roll < skill) {
      // A near miss of each kind: the other part, part of it, extra words, another order, letters off.
      const words = truth.split(' ').filter((w) => /^[A-Za-z]+$/.test(w))
      const plain = !/feat|ft\.|\(|\[| - /i.test(truth)
      const kinds = ['otherPart', ...(plain ? ['extra'] : []), ...(part === 'title' && words.length >= 2 && words.length === truth.split(' ').length ? ['order'] : [])]
      // Not a number word: spec 5.2 keys "Seven" as "7", one character, too short to be part of a title.
      const partWord = words.find((w) => w.length >= 5 && !NUMBER_WORD.test(w) && !also.some((a) => fold(a) === fold(w)) && fold(w) !== fold(other))
      if (partWord && truth.split(' ').length >= 2 && !/feat|\(/i.test(truth)) kinds.push('part')
      if (/^[A-Za-z ]+$/.test(truth) && keyLength(truth) >= 10 && !/^the /i.test(truth) && !digraphs(truth)) kinds.push('spelling')
      const kind = rng.pick(kinds)
      if (kind === 'otherPart') return { text: other, intent: 'close' }
      if (kind === 'extra') return { text: `${truth} Remixed`, intent: 'close' }
      if (kind === 'order') return { text: [...truth.split(' ')].reverse().join(' '), intent: 'close' }
      if (kind === 'part') return { text: partWord!, intent: 'close' }
      return { text: lettersOff(truth, Math.floor(keyLength(truth) / 5) + 1), intent: 'close' }
    }
    // Wrong, and unique to this guest, so a leak of it shows anywhere.
    let token = ''
    let k = ++this.counter
    for (let j = 0; j < 9; j++) {
      token += ODD[k % ODD.length]
      k = Math.floor(k / ODD.length)
    }
    return { text: `${token.slice(0, 4)} ${token.slice(4)}`, intent: 'wrong' }
  }

  host(): HostStep | null {
    const { run } = this
    const state = run.state<SoundtrackState>()
    if (!state) return null
    if (run.rng.chance(0.7)) return run.bot.hostMove?.(hostBotSight(run.party, run.gameId, run.rng.fn())) ?? null
    const played = state.playedAt.length
    const r = run.rng.next()
    if (r < 0.05) return { action: { type: 'crown' }, note: 'crown now' }
    if (r < 0.15) {
      // Who sits out, changed on the night: a few guests by name, sometimes nobody.
      const names = run.present().filter(() => run.rng.chance(0.15)).map((p) => spelling(p.name, run))
      return { action: { type: 'sitOut', names }, note: 'who sits out' }
    }
    if (r < 0.45 && state.review && state.revealed > 0) {
      const index = run.rng.int(state.revealed)
      const part: TypedPart = run.rng.chance(0.5) ? 'title' : 'singer'
      const rows = state.review[index]?.[part] ?? []
      const row = rows.length > 0 ? run.rng.pick(rows) : null
      const key = row?.key ?? 'nobody typed this'
      return { action: { type: 'accept', index, part, key, accepted: run.rng.chance(0.8) ? !row?.accepted : !!row?.accepted }, note: row?.verdict ?? 'no such row' }
    }
    const steps: HostStep[] = [
      { action: { type: 'play', index: played } },
      { action: { type: 'play', index: played + 1 }, note: 'out of order' },
      { action: { type: 'play', index: Math.max(0, played - 1) }, note: 'stale' },
      { action: { type: 'lastCall', after: played } },
      { action: { type: 'more', n: state.extended + 1 } },
      { action: { type: 'more', n: 3 }, note: 'too much' },
      { action: { type: 'lock' } },
      { action: { type: 'reveal', index: state.revealed } },
      { action: { type: 'reveal', index: state.revealed + 1 }, note: 'out of order' },
      { action: { type: 'reveal', index: Math.max(0, state.revealed - 1) }, note: 'stale' },
      { action: { type: 'standings', after: state.revealed } },
    ]
    return run.rng.pick(steps)
  }

  answered(playerId: PlayerId, key: string, answer: AnswerPayload) {
    const list = this.answers.get(key) ?? new Map<PlayerId, AnswerPayload>()
    this.answers.set(key, list)
    list.set(playerId, answer)
  }

  dropped(playerId: PlayerId) {
    for (const list of this.answers.values()) list.delete(playerId)
    this.picks?.delete(playerId)
    this.shownTop.delete(playerId)
  }

  // The round -------------------------------------------------------------------

  after(call: Call, result: Step, _membership: Membership, before: Snapshot) {
    const { run } = this
    const was = before.state as SoundtrackState | null
    if (call.kind === 'host') this.hosted(call.action as { type: string } & Record<string, unknown>, result, was)
    if (result.kind !== 'commit') return
    const state = run.state<SoundtrackState>()
    if (this.picks === null && state.phase === 'locked') this.locked(state)
    // Leaving a top 5: its points are the next one's base for the gains.
    if (was?.phase === 'standings' && state.phase === 'reveal' && state.revealed === was.revealed + 1) {
      this.shownTop = new Map([...this.points(was.revealed)].filter(([, p]) => p !== 0))
    }
  }

  private hosted(action: { type: string } & Record<string, unknown>, result: Step, was: SoundtrackState | null) {
    const { run } = this
    if (!was) return
    if (action.type === 'sitOut') {
      const done = was.phase === 'done'
      if (result.kind === 'refuse' && !done) run.fail('scores-match-oracle', `changing who sits out was refused: ${result.message}`)
      if (result.kind !== 'refuse' && !done) {
        this.sitOut = this.namesOf((action.names as string[]) ?? [])
        run.count('sit out changes')
      }
    }
    if (action.type === 'accept') {
      const index = action.index as number
      const part = action.part as TypedPart
      const key = action.key as string
      const row = was.review?.[index]?.[part]?.find((r) => r.key === key)
      const here = new Set(run.present().map((p) => p.id))
      const valid =
        was.phase !== 'done' &&
        index < was.revealed &&
        row !== undefined &&
        row.players.some((id) => here.has(id)) &&
        row.verdict !== 'exact' &&
        row.verdict !== 'typo'
      if (result.kind === 'refuse' && valid) run.fail('scores-match-oracle', `accepting ${key} was refused: ${result.message}`)
      if (result.kind !== 'refuse' && !valid) run.fail('scores-match-oracle', `accepting ${key} (${row?.verdict ?? 'no row'}) was taken, the rules refuse it`)
      if (valid && result.kind !== 'refuse') {
        this.accepted.set(`${index}|${part}|${key}`, action.accepted as boolean)
        run.count(action.accepted ? 'near misses accepted' : 'accepts taken back')
      }
    }
  }

  /** The lock: everyone here with any answer, as they left it. */
  private locked(state: SoundtrackState) {
    const { run } = this
    const played = state.playedAt.length
    const here = new Set(run.present().map((p) => p.id))
    const picks = new Map<PlayerId, Picks>()
    const entry = (id: PlayerId) => {
      if (!picks.has(id)) picks.set(id, { event: Array(played).fill(null), title: Array(played).fill(null), singer: Array(played).fill(null) })
      return picks.get(id)!
    }
    for (let i = 0; i < played; i++) {
      for (const part of ['event', 'title', 'singer'] as const) {
        for (const [id, answer] of this.answers.get(`s${i + 1}.${part}`) ?? []) {
          if (!here.has(id)) continue
          if (part === 'event' && 'choice' in answer) entry(id).event[i] = answer.choice[0] === 'none' ? null : Number(answer.choice[0])
          if (part !== 'event' && 'text' in answer) entry(id)[part][i] = answer.text.trim()
        }
      }
    }
    this.picks = picks
    run.count('locks')
    const got = state.picks ?? {}
    if (!sameSet(Object.keys(got), [...picks.keys()])) {
      run.fail('scores-match-oracle', `the lock read answers from ${Object.keys(got).length} guests, the oracle ${picks.size}`)
    }
    for (const [id, mine] of picks) {
      if (JSON.stringify(got[id]) !== JSON.stringify(mine)) {
        run.fail('scores-match-oracle', `the lock read ${run.nameOf(id)}'s answers as ${JSON.stringify(got[id])}, they left ${JSON.stringify(mine)}`)
        break
      }
    }
    // The review: every typed answer in exactly one row, judged as it was meant.
    for (let i = 0; i < played; i++) {
      for (const part of ['title', 'singer'] as const) {
        const rows = state.review?.[i]?.[part] ?? []
        for (const [id, mine] of picks) {
          const text = mine[part][i]
          const holding = rows.filter((row) => row.players.includes(id))
          if (text === null) {
            if (holding.length > 0) run.fail('scores-match-oracle', `${run.nameOf(id)} is in a review row of song ${i + 1} without typing`)
            continue
          }
          if (holding.length !== 1) {
            run.fail('scores-match-oracle', `${run.nameOf(id)}'s ${part} for song ${i + 1} is in ${holding.length} review rows`)
            continue
          }
          const intent = this.intents.get(this.intentKey(id, `s${i + 1}.${part}`, text)) ?? 'unknown'
          const verdict = holding[0].verdict
          run.count(`typed ${verdict}`)
          const fits =
            intent === 'unknown' ||
            (intent === 'exact' && verdict === 'exact') ||
            (intent === 'typo' && (verdict === 'typo' || verdict === 'exact')) ||
            (intent === 'close' && verdict === 'close') ||
            (intent === 'wrong' && verdict === 'wrong')
          if (!fits) {
            run.fail('scores-match-oracle', `song ${i + 1}'s ${part} “${text}” (meant ${intent}) was judged ${verdict}; the song says “${part === 'title' ? this.config.songs[i].title : this.config.songs[i].singer}”`)
          }
        }
      }
    }
  }

  /** How one typed part went for a guest: their review row, and whether it counts. */
  private counts(state: SoundtrackState, i: number, part: TypedPart, id: PlayerId): boolean {
    const row: ReviewRow | undefined = state.review?.[i]?.[part]?.find((r) => r.players.includes(id))
    if (!row) return false
    if (row.verdict === 'exact' || row.verdict === 'typo') return true
    const accepted = this.accepted.get(`${i}|${part}|${row.key}`) ?? false
    if (row.accepted !== accepted) this.run.fail('scores-match-oracle', `song ${i + 1}'s row ${row.key} reads accepted ${row.accepted}, the host left it ${accepted}`)
    return accepted
  }

  /** Who scores: guests here with any answer at the lock, not sitting out, in the party's order. */
  private participants(): PlayerId[] {
    if (!this.picks) return []
    return this.run
      .present()
      .map((p) => p.id)
      .filter((id) => this.picks!.has(id) && !this.sittingOut(id))
  }

  /** Each participant's Lydspor points over the first `revealed` songs. */
  private points(revealed: number, perSong?: { event: number; title: number; singer: number }[]): Map<PlayerId, number> {
    const state = this.run.state<SoundtrackState>()
    const { points } = this.config
    const out = new Map<PlayerId, number>()
    for (const id of this.participants()) {
      const mine = this.picks!.get(id)!
      let total = 0
      for (let i = 0; i < revealed; i++) {
        const e = mine.event[i]
        const doubled = e !== null && mine.event.filter((x) => x === e).length > 1
        const right = e !== null && !doubled && state.wall[e] === i
        const title = this.counts(state, i, 'title', id)
        const singer = this.counts(state, i, 'singer', id)
        total += (right ? points.event : 0) + (title ? points.title : 0) + (singer ? points.singer : 0)
        if (perSong) {
          perSong[i].event += right ? 1 : 0
          perSong[i].title += title ? 1 : 0
          perSong[i].singer += singer ? 1 : 0
        }
      }
      out.set(id, total)
    }
    return out
  }

  check() {
    const { run } = this
    const state = run.state<SoundtrackState>()
    const pub = run.publicState<SoundtrackPublicState>()
    if (!state || !pub) return
    const revealed = this.picks ? Math.min(state.revealed, state.playedAt.length) : 0
    const perSong = Array.from({ length: revealed }, () => ({ event: 0, title: 0, singer: 0 }))
    const points = this.points(revealed, perSong)
    const participants = this.participants()
    const pps = this.config.points.event + this.config.points.title + this.config.points.singer
    const most = revealed * pps
    const done = state.phase === 'done'
    const all = participants.map((id) => points.get(id) ?? 0)

    // The board: nothing until the crown, then the scaled payout.
    const want: Record<PlayerId, number> = {}
    const paid = new Map<PlayerId, number>()
    for (const id of participants) {
      const p = points.get(id) ?? 0
      const pay = most > 0 ? Math.round((p * this.config.boardMax) / most) : 0
      paid.set(id, pay)
      if (done && pay !== 0) want[id] = pay
      if (pay < 0 || pay > this.config.boardMax) run.fail('payouts-within-limits', `${run.nameOf(id)} would be paid ${pay}, the most is ${this.config.boardMax}`)
      if (p > most) run.fail('payouts-within-limits', `${run.nameOf(id)} has ${p} Lydspor points from ${revealed} songs at ${pps} each`)
    }
    const got = run.scores()
    if (!sameScores(got, want)) run.fail('scores-match-oracle', `scores are ${show(got, run.nameOf)}, the oracle has ${show(want, run.nameOf)}`)
    for (const value of Object.values(got)) if (value < 0 || value > this.config.boardMax) run.fail('payouts-within-limits', `a payout of ${value} with boardMax ${this.config.boardMax}`)

    if (run.fresh()) {
      // The top 5: points above 0, most first, ties in the party's order, gains since the last top 5.
      const order = new Map(participants.map((id, i) => [id, i]))
      const scored = participants.filter((id) => (points.get(id) ?? 0) > 0)
      const top = scored
        .sort((a, b) => points.get(b)! - points.get(a)! || order.get(a)! - order.get(b)!)
        .slice(0, 5)
        .map((id) => `${id}:${points.get(id)}:${competitionRank(points.get(id)!, all)}:${points.get(id)! - (this.shownTop.get(id) ?? 0)}`)
      if (pub.top.map((row) => `${row.playerId}:${row.points}:${row.rank}:${row.gained}`).join() !== top.join()) {
        run.fail('scores-match-oracle', `the top 5 shows ${pub.top.map((r) => `${run.nameOf(r.playerId)} ${r.points}`).join(', ')}, the oracle ${top.length} rows`)
      }
      if (done) {
        const rows = (pub.final ?? []).map((row) => `${row.playerId}:${row.points}:${row.place}:${row.paid}`).sort()
        const wantRows = participants.map((id) => `${id}:${points.get(id)}:${competitionRank(points.get(id)!, all)}:${paid.get(id)}`).sort()
        if (rows.join() !== wantRows.join()) run.fail('scores-match-oracle', 'the final rows differ from the oracle')
      }
      if (revealed > 0 && pub.reveal) {
        const i = revealed - 1
        const song = this.config.songs[i]
        const r = pub.reveal
        if (r.n !== revealed || r.title !== song.title || r.singer !== song.singer || r.event !== state.wall.indexOf(i)) {
          run.fail('scores-match-oracle', `the reveal of song ${revealed} shows the wrong song or photo`)
        }
        if (r.scoring !== participants.length || JSON.stringify(r.counts) !== JSON.stringify(perSong[i])) {
          run.fail('scores-match-oracle', `song ${revealed}'s reveal counts ${JSON.stringify(r.counts)} of ${r.scoring}, the oracle ${JSON.stringify(perSong[i])} of ${participants.length}`)
        }
      }
      if (pub.playing !== run.present().filter((p) => !this.sittingOut(p.id)).length) run.fail('scores-match-oracle', 'the count of guests playing is off')
    }

    // Phones: their own points, never another guest's typing.
    const views = run.views()
    const texts = new Map<string, PlayerId>()
    for (const [key, list] of this.answers) {
      if (key.endsWith('.event')) continue
      for (const [id, answer] of list) if ('text' in answer && this.intents.get(this.intentKey(id, key, answer.text)) === 'wrong') texts.set(answer.text.trim(), id)
    }
    for (const p of run.present()) {
      const view = views[p.id] as SoundtrackPlayerView | undefined
      if (!view) continue
      if (view.sittingOut !== this.sittingOut(p.id) && run.fresh()) run.fail('scores-match-oracle', `${p.name}'s phone says ${view.sittingOut ? 'sitting out' : 'playing'}`)
      if (!view.sittingOut && view.points !== (points.get(p.id) ?? 0) && this.picks?.has(p.id) && run.fresh()) {
        run.fail('scores-match-oracle', `${p.name}'s phone shows ${view.points} Lydspor points, the oracle ${points.get(p.id) ?? 0}`)
      }
      for (const s of stringsIn(view)) {
        const typist = texts.get(s)
        if (typist !== undefined && typist !== p.id) run.fail('secrets-kept', `${p.name}'s phone shows what another guest typed`)
      }
      // A guest's own answers are theirs to see, the right ones included.
      const own = new Set([...(view.mine?.title ?? []), ...(view.mine?.singer ?? [])].filter((t): t is string => t !== null))
      this.noSongSecrets(view, `${p.name}'s phone`, state, own)
    }
    // The room: no typing ever, no song before its reveal.
    const strings = stringsIn(pub)
    for (const s of strings) if (texts.has(s)) run.fail('secrets-kept', 'a typed answer is in the public state')
    this.noSongSecrets(pub, 'the public state', state)
    for (const prompt of run.prompts()) this.noSongSecrets(prompt.spec, `prompt ${prompt.key}`, state)
    for (const item of run.party.feed) {
      if (item.created_at !== run.party.now) continue
      const words = `${item.message} ${item.detail ?? ''}`
      for (const s of texts.keys()) if (words.includes(s)) run.fail('secrets-kept', 'an announcement carries a typed answer')
    }
    if (revealed > 0 && pub.reveal && pub.reveal.n !== revealed) run.fail('secrets-kept', `the public reveal is song ${pub.reveal.n}, ${revealed} are revealed`)
    const afterLast = revealed > 0 && revealed === state.playedAt.length && ['reveal', 'standings', 'done'].includes(state.phase)
    if (pub.extras !== null && !afterLast) run.fail('secrets-kept', 'the photos that fit no song are public before the last reveal')
  }

  /** No title, singer, other answer, story note or (without hints) caption of a song not revealed yet; other answers and notes never. */
  private noSongSecrets(value: unknown, where: string, state: SoundtrackState, own: ReadonlySet<string> = new Set()) {
    const strings = new Set([...stringsIn(value)].filter((s) => !own.has(s)))
    const played = state.playedAt.length
    // After the last reveal, a song never played is one of the photos that fit no song, caption and all.
    const afterLast = state.revealed > 0 && state.revealed === played && ['reveal', 'standings', 'done'].includes(state.phase)
    this.config.songs.forEach((song, i) => {
      const out = i < state.revealed && this.picks !== null
      const captionShown = this.config.hints || (afterLast && i >= played)
      const secret = [...song.alsoTitles, ...song.alsoSingers, song.note, ...(out ? [] : [song.title, song.singer, ...(captionShown ? [] : [song.caption])])]
      const shown = out ? [song.title, song.singer, song.caption] : []
      for (const s of secret) if (strings.has(s) && !shown.includes(s)) this.run.fail('secrets-kept', `${where} has “${s}” of song ${i + 1} before its moment`)
    })
  }

  finished() {
    const { run } = this
    const state = run.state<SoundtrackState>()
    const revealed = this.picks ? Math.min(state.revealed, state.playedAt.length) : 0
    const points = this.points(revealed)
    const all = this.participants().map((id) => points.get(id) ?? 0)
    const top = Math.max(0, ...all)
    const want = top > 0 ? this.participants().filter((id) => points.get(id) === top) : []
    const got = run.party.game(run.gameId).winners
    if (!sameSet(got, want)) {
      run.fail('winners-match-oracle', `Lydspor crowned ${got.map(run.nameOf).join(', ') || 'nobody'}, the oracle ${want.map(run.nameOf).join(', ') || 'nobody'}`)
    }
  }
}

/** Whether a text has a Danish digraph the matcher folds (aa, ae, oe), or a letter it spells as one (æ, ø, å). */
const digraphs = (text: string) => /aa|ae|oe|[æøå]/i.test(text)

/** Letters a to z and digits only, as the matcher's key counts them. */
const keyLength = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '').length

/** Two neighbouring plain letters swapped inside a word (never a word's first letter), or null. */
function swapInside(text: string, seed: number): string | null {
  const letters = [...text]
  const spots = letters
    .map((_, i) => i)
    .filter((i) => i > 0 && i < letters.length - 1 && /[a-z]/.test(letters[i]) && /[a-z]/.test(letters[i + 1]) && /[A-Za-z]/.test(letters[i - 1]) && letters[i] !== letters[i + 1])
  if (spots.length === 0) return null
  const i = spots[seed % spots.length]
  ;[letters[i], letters[i + 1]] = [letters[i + 1], letters[i]]
  return letters.join('')
}

/** `count` plain letters changed to x or q inside words: more wrong letters than a typo is forgiven. */
function lettersOff(text: string, count: number): string {
  const letters = [...text]
  const spots = letters.map((_, i) => i).filter((i) => i > 0 && /[a-z]/.test(letters[i]) && /[A-Za-z]/.test(letters[i - 1]))
  const step = Math.max(1, Math.floor(spots.length / (count + 1)))
  for (let k = 0; k < count && k * step < spots.length; k++) {
    const i = spots[(k + 1) * step - 1] ?? spots[k]
    letters[i] = letters[i] === 'x' ? 'q' : 'x'
  }
  return letters.join('')
}
