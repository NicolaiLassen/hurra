// Participant fusion's oracle: the host asks the pictures one at a time, in
// any order; each guest here locks in two names once; a name counts when it
// folds to one of the two in the picture, never the guest's own (except in
// teams, where every member has the team's lock and it counts); per right
// person and a bonus for both; the top of the totals among guests here is the
// face detective. Recomputed from the locks the database took, the key the
// settings and the host's Show who gave, and each prompt's reveal. The names,
// a picture's image before it is asked, and its two own photos before its
// reveal are the secrets.
import { botSight, hostBotSight } from '../../../src/games/core/contract'
import type { AnswerPayload, PlayerId, Prompt } from '../../../src/games/core/Game'
import type { Step } from '../../../src/games/core/runtime'
import type { FusionConfig, FusionPicture, FusionState } from '../../../src/games/fusion/logic'
import type { FusionPlayerView, FusionPublicState } from '../../../src/games/fusion/shapes'
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
  type Move,
  type Oracle,
  type Run,
} from '../core'

/** Names in a picture of someone who never joins. */
const GHOSTS = ['Moster Ingen', 'Fætter Fjern', 'Oldemor Billede']

/** A spelling of a name the guest might not type the same way: case, accents and spaces. */
function variant(name: string, run: Run): string {
  const r = run.rng.next()
  if (r < 0.5) return name
  if (r < 0.65) return name.toLowerCase()
  if (r < 0.75) return name.toUpperCase()
  if (r < 0.9) return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return `  ${name.split(' ').join('   ')} `
}

export const fusion: Adapter = {
  type: 'fusion',
  settings(run) {
    const { rng } = run
    const people = [...run.present(), ...run.expected()]
    const pool = [...people.map((p) => p.name), ...GHOSTS]
    const count = rng.between(1, run.size >= 24 ? 8 : 6)
    const own = (name: string) => `verify/fusion/s${run.seed}/own-${fold(name).replace(/[^a-z0-9]/g, '') || 'x'}.jpg`
    return {
      pointsPerPerson: rng.between(0, 3),
      bonusForBoth: rng.between(0, 3),
      seconds: rng.between(10, 30),
      pictures: Array.from({ length: count }, (_, i) => {
        const n = i + 1
        const picture: Record<string, unknown> = { label: rng.chance(0.3) ? '' : rng.chance(0.5) ? `#${n}` : `Print ${n}` }
        if (rng.chance(0.85)) picture.image = `verify/fusion/s${run.seed}/picture-${n}.jpg`
        if (rng.chance(0.8) && pool.length >= 2) {
          const a = rng.pick(pool)
          const others = pool.filter((name) => fold(name) !== fold(a))
          if (others.length > 0) {
            const b = rng.pick(others)
            // Settings saved before names held the guests' ids; those still read as the guests' names.
            const byId = rng.chance(0.1) ? people.filter((p) => p.name === a || p.name === b).map((p) => p.id) : []
            picture.people = byId.length === 2 ? byId : [variant(a, run), variant(b, run)]
            if (rng.chance(0.6)) picture.originals = [rng.chance(0.8) ? own(a) : null, rng.chance(0.8) ? own(b) : null]
          }
        }
        return picture
      }),
    }
  },
  begin: (run) => new FusionOracle(run),
}

type Reveal = { names: [string, string]; both: number; one: number; none: number; voters: number; step: number }

class FusionOracle implements Oracle {
  private readonly config: FusionConfig
  /** Who is in each picture, by number: the settings' names, then Show who. */
  private readonly key = new Map<number, [string, string]>()
  /** First locks per prompt key. */
  private readonly locks = new Map<string, Map<PlayerId, string[]>>()
  private readonly totals = new Map<PlayerId, number>()
  private readonly hits = new Map<number, Map<PlayerId, number>>()
  private readonly reveals = new Map<number, Reveal>()
  private readonly order: number[] = []
  /** The names each picture's guess offered, by fold, from the moment it was asked. */
  private readonly offered = new Map<string, Set<string>>()
  private readonly skill = new Map<PlayerId, number>()

  private readonly run: Run

  constructor(run: Run) {
    this.run = run
    this.config = run.config<FusionConfig>()
    const guests = [...run.present(), ...run.expected()]
    this.config.pictures.forEach((picture, i) => {
      if (!picture.people) return
      const names = picture.people.map((value) => tidyName(guests.find((g) => g.id === value)?.name ?? value)) as [string, string]
      this.key.set(i + 1, names)
    })
    const state = run.state<FusionState>()
    for (const [n, names] of this.key) {
      const got = state.key[n]
      if (!got || got[0] !== names[0] || got[1] !== names[1]) {
        run.fail('scores-match-oracle', `picture ${n} starts with ${JSON.stringify(got)}, the settings say ${JSON.stringify(names)}`)
      }
    }
  }

  private skillOf(id: PlayerId) {
    if (!this.skill.has(id)) this.skill.set(id, this.run.rng.next())
    return this.skill.get(id)!
  }

  guest(playerId: PlayerId): Move | null {
    const { run } = this
    const pub = run.publicState<FusionPublicState>()
    const move = run.bot.move(botSight(run.party, run.gameId, playerId, run.rng.fn()))
    // Now and then a lock before the picker shows (the database takes it), with the guest's own name in it.
    if (!move && pub?.phase === 'asking' && pub.current && run.rng.chance(0.004)) {
      const prompt = run.prompts().find((p) => p.key === pub.current!.key)
      const options = prompt?.spec.kind === 'choice' && Array.isArray(prompt.spec.options) ? prompt.spec.options : []
      const me = options.find((o) => fold(o) === fold(run.nameOf(playerId)))
      const other = options.find((o) => o !== me)
      if (me && other) return { kind: 'answer', key: pub.current.key, answer: { choice: [me, other] }, note: 'with their own name' }
    }
    if (!move || move.kind !== 'answer' || !pub?.current) return move
    const n = pub.current.n
    const names = this.key.get(n)
    const prompt = run.prompts().find((p) => p.key === move.key)
    const options = prompt?.spec.kind === 'choice' && Array.isArray(prompt.spec.options) ? prompt.spec.options : []
    if (!names || options.length < 2) return move
    const me = fold(run.nameOf(playerId))
    const spelled = (name: string) => options.find((o) => fold(o) === fold(name))
    const right = names.filter((name) => fold(name) !== me).map(spelled).filter((x): x is string => x !== undefined)
    const roll = run.rng.next()
    const skill = this.skillOf(playerId)
    let picks: string[] | null = null
    if (roll < skill * 0.6) picks = right.slice(0, 2)
    else if (roll < skill) picks = right.slice(0, 1)
    if (!picks) return move
    const rest = run.rng.shuffle(options.filter((o) => !picks!.includes(o) && fold(o) !== me))
    while (picks.length < 2 && rest.length > 0) picks.push(rest.pop()!)
    if (picks.length < 2) return move
    return { kind: 'answer', key: move.key, answer: { choice: picks }, note: `${right.filter((r) => picks!.includes(r)).length} right` }
  }

  host(): HostStep | null {
    const { run } = this
    const state = run.state<FusionState>()
    if (!state) return null
    if (run.rng.chance(0.7)) return run.bot.hostMove?.(hostBotSight(run.party, run.gameId, run.rng.fn())) ?? null
    const pictures = this.config.pictures.map((_, i) => i + 1)
    const waiting = pictures.filter((n) => !state.revealed.includes(n))
    const pool = [...run.present().map((p) => p.name), ...run.expected().map((g) => g.name), ...GHOSTS]
    const any = (list: number[]) => (list.length > 0 ? run.rng.pick(list) : 1)
    const current = state.current ?? any(pictures)
    const a = run.rng.pick(pool)
    const b = run.rng.pick(pool)
    const steps: HostStep[] = [
      { action: { type: 'ask', n: any(waiting) }, note: 'any picture' },
      { action: { type: 'ask', n: any(pictures) }, note: 'maybe asked' },
      { action: { type: 'setKey', n: any(waiting), people: [variant(a, run), variant(b, run)] }, note: 'Show who' },
      { action: { type: 'setKey', n: any(pictures), people: [a, a.toLowerCase()] }, note: 'the same name twice' },
      { action: { type: 'reveal', n: current }, close: [`p${current}`] },
      { action: { type: 'reveal', n: current }, note: 'without closing' },
      { action: { type: 'wall', from: 'reveal', n: current } },
      { action: { type: 'wall', from: 'lobby' } },
    ]
    if (run.rng.chance(0.03)) return { action: { type: 'finish' }, note: 'crown now' }
    return run.rng.pick(steps)
  }

  answered(playerId: PlayerId, key: string, answer: AnswerPayload) {
    const list = this.locks.get(key) ?? new Map<PlayerId, string[]>()
    this.locks.set(key, list)
    if (!list.has(playerId) && 'choice' in answer) list.set(playerId, [...answer.choice])
  }

  dropped(playerId: PlayerId) {
    for (const list of this.locks.values()) list.delete(playerId)
    this.totals.delete(playerId)
    for (const list of this.hits.values()) list.delete(playerId)
  }

  // No apart(): in teams a guest's own name counts for them as for their teammates, so a team scores as one.

  after(call: Call, result: Step) {
    const { run } = this
    if (call.kind === 'host') {
      const action = call.action as { type: string; n?: number; people?: [string, string] }
      if (action.type === 'setKey') this.setKey(action.n!, action.people!, result)
    }
    if (result.kind !== 'commit') return
    for (const prompt of run.prompts()) {
      if (!this.offered.has(prompt.key)) this.asked(prompt)
      if (prompt.revealedAt !== null && !this.reveals.has(Number(prompt.key.slice(1)))) this.score(prompt)
    }
  }

  /** Show who, by the rules: two different names, not on a revealed picture; the same two again change nothing. */
  private setKey(n: number, people: [string, string], result: Step) {
    const { run } = this
    const picture: FusionPicture | undefined = this.config.pictures[n - 1]
    const guests = [...run.present(), ...run.expected()]
    const [a, b] = people.map((value) => tidyName(guests.find((g) => g.id === value)?.name ?? value))
    const valid = picture !== undefined && !this.reveals.has(n) && a !== '' && b !== '' && fold(a) !== fold(b) && a.length <= 40 && b.length <= 40
    const done = run.party.game(run.gameId).status !== 'active' || run.state<FusionState>().phase === 'done'
    if (result.kind === 'refuse' && valid && !done) run.fail('scores-match-oracle', `Show who ${a} and ${b} on picture ${n} was refused: ${result.message}`)
    if (result.kind !== 'refuse' && !valid) run.fail('scores-match-oracle', `Show who ${a} and ${b} on picture ${n} was taken, the rules refuse it`)
    if (result.kind === 'refuse' || !valid || done) return
    const current = this.key.get(n)
    const ordered = picture.originals?.some((path) => path !== null) ?? false
    const same = current && ((current[0] === a && current[1] === b) || (!ordered && current[0] === b && current[1] === a))
    if (!same) this.key.set(n, [a, b])
    run.count('Show who taken')
  }

  /** A picture was asked: its guess offers everyone here and every name in the pictures, the same whichever picture it is. */
  private asked(prompt: Prompt) {
    const { run } = this
    const offered = prompt.spec.kind === 'choice' && Array.isArray(prompt.spec.options) ? prompt.spec.options : []
    const folds = new Set(offered.map(fold))
    this.offered.set(prompt.key, folds)
    const want = new Set([...run.present().map((p) => fold(p.name)), ...[...this.key.values()].flat().map(fold)])
    if (!sameSet([...folds], [...want])) {
      run.fail('secrets-kept', `${prompt.key}'s guess offers ${offered.length} names, not exactly everyone here and every name in the pictures`)
    }
    if (folds.size !== offered.length) run.fail('scores-match-oracle', `${prompt.key}'s guess offers a name twice`)
  }

  /** A picture's reveal: every lock from a guest here, its hits against the key, its points. */
  private score(prompt: Prompt) {
    const { run } = this
    const n = Number(prompt.key.slice(1))
    const names = this.key.get(n)
    if (!names) return run.fail('scores-match-oracle', `picture ${n} was revealed without anyone in it`)
    const present = new Map(run.present().map((p) => [p.id, p]))
    const per = this.config.pointsPerPerson
    const bonus = this.config.bonusForBoth
    const reveal: Reveal = { names, both: 0, one: 0, none: 0, voters: 0, step: this.order.length + 1 }
    const hits = new Map<PlayerId, number>()
    for (const [id, picks] of this.locks.get(prompt.key) ?? []) {
      const voter = present.get(id)
      if (!voter) continue
      // Their own name counts for nothing, except in teams (a teammate may have named them).
      const own = run.teams ? '' : fold(voter.name)
      const picked = new Set(picks.map(fold).filter((f) => f !== '' && f !== own))
      const count = names.filter((name) => picked.has(fold(name))).length
      hits.set(id, count)
      reveal.voters++
      if (count === 2) reveal.both++
      else if (count === 1) reveal.one++
      else reveal.none++
      const points = count * per + (count === 2 ? bonus : 0)
      run.count('names right', count)
      if (points > 2 * per + bonus) run.fail('payouts-within-limits', `a picture paid ${points}, more than ${2 * per + bonus}`)
      if (points > 0) this.totals.set(id, (this.totals.get(id) ?? 0) + points)
    }
    this.hits.set(n, hits)
    this.reveals.set(n, reveal)
    run.count('pictures revealed')
    this.order.push(n)
  }

  check() {
    const { run } = this
    const present = run.present()
    const here = new Set(present.map((p) => p.id))
    const want: Record<PlayerId, number> = {}
    for (const [id, points] of this.totals) if (here.has(id) && points !== 0) want[id] = points
    const got = run.scores()
    if (!sameScores(got, want)) run.fail('scores-match-oracle', `scores are ${show(got, run.nameOf)}, the oracle has ${show(want, run.nameOf)}`)
    const most = this.order.length * (2 * this.config.pointsPerPerson + this.config.bonusForBoth)
    for (const [id, points] of Object.entries(got)) if (points < 0 || points > most) run.fail('payouts-within-limits', `${run.nameOf(id)} has ${points}, more than ${most}`)

    const scored = present.map((p) => this.totals.get(p.id) ?? 0).filter((x) => x > 0)
    const views = run.views()
    for (const p of present) {
      const view = views[p.id] as FusionPlayerView | undefined
      if (!view) continue
      const points = this.totals.get(p.id) ?? 0
      const rank = points > 0 ? competitionRank(points, scored) : null
      const mine: Record<string, number> = {}
      for (const n of this.order) {
        const count = this.hits.get(n)?.get(p.id)
        if (count !== undefined) mine[n] = count
      }
      if (view.points !== points || (run.fresh() && view.rank !== rank) || JSON.stringify(sortKeys(view.hits)) !== JSON.stringify(sortKeys(mine))) {
        run.fail('scores-match-oracle', `${p.name}'s phone shows ${view.points} points, rank ${view.rank}, hits ${JSON.stringify(view.hits)}; the oracle has ${points}, ${rank}, ${JSON.stringify(mine)}`)
      }
      if (stringsIn(view).size > Object.keys(view.hits).length) {
        const leaks = [...stringsIn(view)].filter((s) => !(s in view.hits) && !['points', 'rank', 'hits'].includes(s))
        if (leaks.length > 0) run.fail('secrets-kept', `${p.name}'s phone carries text: ${leaks.slice(0, 2).join(', ')}`)
      }
    }

    const pub = run.publicState<FusionPublicState>()
    if (!pub) return
    const order = new Map(present.map((p, i) => [p.id, i]))
    const top = present
      .map((p) => ({ id: p.id, points: this.totals.get(p.id) ?? 0 }))
      .filter((row) => row.points > 0)
      .sort((a, b) => b.points - a.points || order.get(a.id)! - order.get(b.id)!)
      .slice(0, 5)
      .map((row) => `${row.id}:${row.points}:${competitionRank(row.points, scored)}`)
    if (run.fresh() && pub.top.map((row) => `${row.playerId}:${row.points}:${row.rank}`).join() !== top.join()) {
      run.fail('scores-match-oracle', 'the top 5 differs from the oracle')
    }

    // Each picture: its image only once asked; who is in it and their own photos only once revealed.
    const state = run.state<FusionState>()
    const asking = (pub.phase === 'asking' || pub.phase === 'reveal') && state.current !== null
    const revealedNames = new Set([...this.reveals.values()].flatMap((r) => r.names))
    const revealedPaths = new Set<string>()
    const askedImages = new Set<string>()
    this.config.pictures.forEach((picture, i) => {
      const n = i + 1
      if (this.reveals.has(n)) for (const path of picture.originals ?? []) if (path) revealedPaths.add(path)
      if ((this.reveals.has(n) || (asking && state.current === n)) && picture.image) askedImages.add(picture.image)
    })
    const strings = stringsIn(pub)
    this.config.pictures.forEach((picture, i) => {
      const n = i + 1
      const shown = pub.pictures[i]
      const asked = this.reveals.has(n) || (asking && state.current === n)
      if (!shown) return run.fail('scores-match-oracle', `picture ${n} is missing from the public state`)
      if (shown.asked !== asked) run.fail('secrets-kept', `picture ${n} reads ${shown.asked ? 'asked' : 'not asked'}, the host ${asked ? 'asked it' : "hasn't asked it"}`)
      if (!asked && shown.image !== null) run.fail('secrets-kept', `picture ${n}'s image is public before it is asked`)
      if (asked && shown.image !== (picture.image ?? null)) run.fail('scores-match-oracle', `picture ${n} shows the wrong image`)
      if (picture.image && !askedImages.has(picture.image) && strings.has(picture.image)) run.fail('secrets-kept', `picture ${n}'s image path is public before it is asked`)
      const reveal = this.reveals.get(n)
      if (!reveal) {
        if (shown.revealed !== null) run.fail('secrets-kept', `picture ${n} is revealed in the public state before its reveal`)
        for (const name of this.key.get(n) ?? []) {
          if (!revealedNames.has(name) && strings.has(name)) run.fail('secrets-kept', `who is in picture ${n} (${name}) is public before its reveal`)
        }
        for (const path of picture.originals ?? []) {
          if (path && !revealedPaths.has(path) && strings.has(path)) run.fail('secrets-kept', `an own photo of picture ${n} is public before its reveal`)
        }
        return
      }
      const r = shown.revealed
      const originals = [picture.originals?.[0] ?? null, picture.originals?.[1] ?? null]
      if (
        !r ||
        r.names[0] !== reveal.names[0] ||
        r.names[1] !== reveal.names[1] ||
        r.both !== reveal.both ||
        r.one !== reveal.one ||
        r.none !== reveal.none ||
        r.voters !== reveal.voters ||
        r.step !== reveal.step ||
        r.originals[0] !== originals[0] ||
        r.originals[1] !== originals[1]
      ) {
        run.fail('scores-match-oracle', `picture ${n}'s reveal shows ${JSON.stringify(r && { ...r, at: undefined })}, the oracle ${JSON.stringify(reveal)}`)
      }
    })
    for (const item of run.party.feed) {
      const text = `${item.message} ${item.detail ?? ''}`
      for (const picture of this.config.pictures) {
        for (const path of [picture.image, ...(picture.originals ?? [])]) if (path && text.includes(path)) run.fail('secrets-kept', 'an announcement carries a picture path')
      }
    }
  }

  finished() {
    const { run } = this
    const present = run.present()
    const top = Math.max(0, ...present.map((p) => this.totals.get(p.id) ?? 0))
    const want = top > 0 ? present.filter((p) => (this.totals.get(p.id) ?? 0) === top).map((p) => p.id) : []
    const got = run.party.game(run.gameId).winners
    if (!sameSet(got, want)) {
      run.fail('winners-match-oracle', `fusion crowned ${got.map(run.nameOf).join(', ') || 'nobody'}, the oracle ${want.map(run.nameOf).join(', ') || 'nobody'}`)
    }
  }
}

function sortKeys(record: Record<string, number>) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => Number(a) - Number(b)))
}
