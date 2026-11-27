// Last one standing's oracle: one life and one secret task each; a tag takes
// the target's task over, a catch keeps your own; points per tag and per catch
// for knockouts by guests still here; the last one standing of more than one
// dealt in wins, by a knockout or by the others leaving. Latecomers are dealt
// the next undealt card while dealing in is open (the host's switch, and the
// minutes after the start), never a second life, and a freed name taken again
// watches. Recomputed from the knockouts the engine took and the membership
// each save saw.
import { botSight } from '../../../src/games/core/contract'
import type { PlayerId } from '../../../src/games/core/Game'
import type { Step } from '../../../src/games/core/runtime'
import type {
  EliminationConfig,
  EliminationPlayerView,
  EliminationPublicState,
  EliminationState,
} from '../../../src/games/elimination/logic'
import {
  sameScores,
  sameSet,
  show,
  stringsIn,
  type Adapter,
  type Call,
  type HostStep,
  type Membership,
  type Move,
  type Oracle,
  type Run,
  type Snapshot,
} from '../core'

const TASKS = Array.from({ length: 70 }, (_, i) => `Verifier task ${i + 1}: get someone to say the word ${['kettle', 'harbour', 'lantern', 'violin', 'meadow'][i % 5]} ${i + 1}`)

export const elimination: Adapter = {
  type: 'elimination',
  minPlayers: 2,
  // An evening of comings and goings while the hunt runs.
  churn: 2.5,
  settings(run) {
    const { rng } = run
    const roll = rng.next()
    // Few tasks (so they repeat once dealt out), as many as guests, plenty, or the default 60.
    const tasks =
      roll < 0.25
        ? TASKS.slice(0, rng.between(1, 4))
        : roll < 0.5
          ? TASKS.slice(0, Math.max(1, run.size + rng.between(-1, 2)))
          : roll < 0.75
            ? TASKS.slice(0, 70)
            : undefined
    return {
      // With a blank and a repeat now and then, which the start cleans up.
      ...(tasks ? { tasks: rng.chance(0.2) ? [...tasks, '  ', tasks[0]] : tasks } : {}),
      pointsPerTag: rng.between(0, 4),
      pointsPerCatch: rng.between(0, 4),
      dealInMinutes: rng.pick([0, 1, 2, 5, 105]),
    }
  },
  begin: (run) => new EliminationOracle(run),
}

type Model = {
  /** Who holds which task now (dealt in, still in, and not gone from the party as the last save saw it). */
  tasks: Map<PlayerId, string>
  /** Dealt in this round, in deal order. */
  dealt: PlayerId[]
  /** Dealt in, then gone from the party. */
  left: Set<PlayerId>
  /** With the knocker's occupant number: a freed name's next guest never inherits them. */
  knockouts: { by: PlayerId; byEpoch: number; target: PlayerId; method: 'tag' | 'catch'; task: string }[]
  deck: string[]
  next: number
  open: boolean
  until: number | null
  winner: PlayerId | null
}

class EliminationOracle implements Oracle {
  private readonly config: EliminationConfig
  private model: Model

  private readonly run: Run

  constructor(run: Run) {
    this.run = run
    this.config = run.config<EliminationConfig>()
    const state = run.state<EliminationState>()
    const cleaned = [...new Set(this.config.tasks.map((t) => t.trim()).filter(Boolean))]
    const deck = state.deck ?? []
    if (deck.length !== cleaned.length || !sameSet(deck, cleaned)) {
      run.fail('latecomers-dealt-fairly', 'the deck is not the settings’ tasks, each once')
    }
    const present = run.present().map((p) => p.id)
    const minutes = this.config.dealInMinutes
    this.model = {
      tasks: new Map(),
      dealt: [],
      left: new Set(),
      knockouts: [],
      deck: [...deck],
      next: 0,
      open: true,
      until: minutes > 0 ? run.party.now + minutes * 60_000 : null,
      winner: null,
    }
    for (const id of present) this.deal(this.model, id, 'at the start')
    if (!sameSet(state.playerIds, present)) run.fail('latecomers-dealt-fairly', 'the start did not deal in exactly the guests here')
    this.compareTasks('the start')
  }

  /** Deals the next card as the rules say: the top undealt card, then a repeat nobody holds, then the least held. */
  private deal(m: Model, id: PlayerId, why: string): string | null {
    if (m.deck.length === 0) return null
    if (why !== 'at the start') this.run.count(m.next < m.deck.length ? 'latecomers dealt an undealt card' : 'latecomers dealt a repeat')
    let task: string
    if (m.next < m.deck.length) task = m.deck[m.next]
    else {
      const held = new Map<string, number>()
      for (const t of m.tasks.values()) held.set(t, (held.get(t) ?? 0) + 1)
      const shown = new Set(m.knockouts.map((k) => k.task))
      task =
        m.deck.find((t) => !held.has(t) && !shown.has(t)) ??
        m.deck.find((t) => !held.has(t)) ??
        m.deck.reduce((fewest, t) => ((held.get(t) ?? 0) < (held.get(fewest) ?? 0) ? t : fewest))
    }
    m.next++
    m.tasks.set(id, task)
    m.dealt.push(id)
    void why
    return task
  }

  private dealingIn(m: Model, now: number) {
    return m.open && (m.until === null || now < m.until)
  }

  private standing(m: Model, present: Set<PlayerId>) {
    return m.dealt.filter((id) => m.tasks.has(id) && present.has(id))
  }

  private winnerOf(m: Model, present: Set<PlayerId>) {
    const left = this.standing(m, present)
    return left.length === 1 && m.dealt.length > 1 ? left[0] : null
  }

  /** The membership a save picked up, applied to a model: leaves (a task goes with its holder), then joins (dealt in if they may be). */
  private applyMembership(m: Model, membership: Membership, present: Set<PlayerId>, now: number, check: boolean) {
    for (const id of membership.left) {
      if (!m.dealt.includes(id)) continue
      m.left.add(id)
      m.tasks.delete(id)
    }
    if (m.winner === null) m.winner = this.winnerOf(m, present)
    for (const id of membership.joined) this.dealIn(m, id, present, now, check, 'joined')
  }

  private dealIn(m: Model, id: PlayerId, present: Set<PlayerId>, now: number, check: boolean, why: string) {
    if (m.dealt.includes(id) || !present.has(id)) return
    if (!this.dealingIn(m, now) || m.winner !== null || this.winnerOf(m, present) !== null) return
    const undealt = m.next < m.deck.length
    const task = this.deal(m, id, why)
    if (check && task !== null && undealt && [...m.tasks].some(([other, t]) => other !== id && t === task)) {
      this.run.fail('latecomers-dealt-fairly', `${this.run.nameOf(id)} was dealt a task someone holds while undealt cards were left`)
    }
  }

  guest(playerId: PlayerId): Move | null {
    const { run } = this
    const r = run.rng.next()
    // Now and then a knockout the rules refuse: your own code, someone out, someone gone, a stranger, or a guest who never played.
    if (r < 0.006) {
      const out = this.model.dealt.filter((id) => !this.model.tasks.has(id))
      const target = run.rng.pick([playerId, ...out, '00000000-0000-4000-8000-00000000beef', ...[...this.model.left]])
      return { kind: 'action', action: { type: run.rng.chance(0.5) ? 'tag' : 'catch', target }, note: 'refused, by the rules' }
    }
    if (r < 0.01) return { kind: 'action', action: { type: 'join' }, note: 'asks to be dealt in' }
    // The hunt runs all evening: a guest's phone acts on a third of the bot's calls, so latecomers come while it runs.
    const view = run.views()[playerId] as EliminationPlayerView | undefined
    if (view && r > 0.35) return null
    return run.bot.move(botSight(run.party, run.gameId, playerId, run.rng.fn()))
  }

  host(): HostStep | null {
    // The host's switch for latecomers, now and then, either way.
    if (!this.run.rng.chance(0.02)) return null
    return { action: { type: 'dealIn', open: this.run.rng.chance(0.5) } }
  }

  answered() {}
  dropped() {}

  after(call: Call, result: Step, membership: Membership, before: Snapshot) {
    const { run } = this
    const present = new Set(run.present().map((p) => p.id))
    const now = before.now
    // What the rules say this call does, on the membership its save picks up.
    const m = structuredClone(this.model)
    this.applyMembership(m, membership, present, now, true)
    if (call.kind === 'action') {
      const action = call.action as { type: string; target?: string }
      const by = call.playerId
      if (action.type === 'tag' || action.type === 'catch') {
        const target = action.target!
        const valid = m.winner === null && m.tasks.has(by) && target !== by && present.has(target) && m.tasks.has(target)
        if (valid) {
          const targetTask = m.tasks.get(target)!
          const task = action.type === 'tag' ? m.tasks.get(by)! : targetTask
          m.tasks.delete(target)
          if (action.type === 'tag') m.tasks.set(by, targetTask)
          m.knockouts.push({ by, byEpoch: run.epoch(by), target, method: action.type, task })
          m.winner = this.winnerOf(m, present)
          if (result.kind === 'commit') run.count(`${action.type}s`)
        }
        // A round the save's leaves decided takes the tap without a knockout: that save crowns the winner.
        if (result.kind !== 'refuse' && !valid && m.winner === null) {
          run.fail('scores-match-oracle', `the knockout ${JSON.stringify(action)} was taken, the rules refuse it`)
        }
        if (result.kind === 'refuse' && m.winner !== null) run.fail('finishes-cleanly', `a tap on a decided round was refused (${result.message}), so its crown was lost`)
        if (result.kind === 'refuse' && valid && result.code === 'rule') {
          run.fail('scores-match-oracle', `the knockout ${JSON.stringify(action)} was refused (${result.message}), the rules allow it`)
        }
      } else if (action.type === 'join') {
        this.dealIn(m, by, present, now, true, 'asked')
      }
    }
    if (call.kind === 'host') {
      const action = call.action as { type: string; open: boolean }
      if (!action.open) {
        if (this.dealingIn(m, now)) {
          m.open = false
          m.until = null
        }
      } else if (!(m.open && m.until === null)) {
        m.open = true
        m.until = null
        for (const p of run.present()) this.dealIn(m, p.id, present, now, true, 'the host opened dealing in')
      }
    }
    if (result.kind === 'refuse' || ('replayed' in result && result.replayed)) return
    if (result.kind === 'skip') {
      // Nothing saved: then the rules had nothing to change either.
      if (m.dealt.length !== this.model.dealt.length || m.knockouts.length !== this.model.knockouts.length) {
        run.fail('latecomers-dealt-fairly', `${call.kind} changed nothing, the rules deal in ${m.dealt.length - this.model.dealt.length} and knock out ${m.knockouts.length - this.model.knockouts.length}`)
      }
      return
    }
    // A committed save: what it actually dealt, then the model moves on.
    const was = (before.state as EliminationState | null)?.playerIds ?? []
    const state = run.state<EliminationState>()
    for (const id of state.playerIds) {
      if (was.includes(id)) continue
      if (!m.dealt.includes(id)) run.fail('latecomers-dealt-fairly', `${run.nameOf(id)} was dealt in, the rules say they watch (${this.why(id, present, now)})`)
    }
    if (new Set(state.playerIds).size !== state.playerIds.length) run.fail('latecomers-dealt-fairly', 'someone was dealt in twice')
    for (const id of m.dealt) {
      if (!state.playerIds.includes(id)) run.fail('latecomers-dealt-fairly', `${run.nameOf(id)} should have been dealt in and wasn't`)
    }
    const pub = run.publicState<EliminationPublicState>()
    if (pub && run.party.game(run.gameId).status === 'active') {
      if (pub.dealIn !== this.dealingIn(m, now)) {
        run.fail('latecomers-dealt-fairly', `the TV says dealing in is ${pub.dealIn ? 'open' : 'closed'}, the rules say it is ${pub.dealIn ? 'closed' : 'open'}`)
      }
      const standing = this.standing(m, present)
      if (!sameSet(pub.alive, standing)) run.fail('scores-match-oracle', `${pub.alive.length} standing on the TV, the oracle has ${standing.length}`)
    }
    if (pub && pub.winner !== this.winnerOf(m, present)) run.fail('winners-match-oracle', 'the public winner differs from the oracle')
    this.model = m
    this.compareTasks(`after ${call.kind}`)
  }

  /** Why a guest may not be dealt in now, for messages. */
  private why(id: PlayerId, present: Set<PlayerId>, now: number) {
    const m = this.model
    if (m.dealt.includes(id)) return 'dealt in before'
    if (!present.has(id)) return 'not here'
    if (!this.dealingIn(m, now)) return 'dealing in is closed'
    return m.winner ? 'the round has a winner' : 'no card'
  }

  /** Every task as the model has it, and every phone's view of it. */
  private compareTasks(when: string) {
    const { run } = this
    const state = run.state<EliminationState>()
    const present = new Set(run.present().map((p) => p.id))
    const m = this.model
    for (const [id, task] of m.tasks) {
      if (state.tasks[id] !== task) {
        run.fail('latecomers-dealt-fairly', `${when}: ${run.nameOf(id)} holds “${state.tasks[id] ?? 'nothing'}”, the deal gives “${task}”`)
        return
      }
    }
    for (const id of Object.keys(state.tasks)) {
      if (!m.tasks.has(id) && present.has(id)) run.fail('scores-match-oracle', `${when}: ${run.nameOf(id)} still holds a task, the rules say they're out`)
    }
  }

  check() {
    const { run } = this
    const m = this.model
    const present = run.present()
    const here = new Set(present.map((p) => p.id))
    const pub = run.publicState<EliminationPublicState>()

    const want: Record<PlayerId, number> = {}
    for (const k of m.knockouts) {
      if (m.left.has(k.by) || !here.has(k.by) || run.epoch(k.by) !== k.byEpoch) continue
      want[k.by] = (want[k.by] ?? 0) + (k.method === 'tag' ? this.config.pointsPerTag : this.config.pointsPerCatch)
    }
    for (const id of Object.keys(want)) if (want[id] === 0) delete want[id]
    const got = run.scores()
    if (!sameScores(got, want)) run.fail('scores-match-oracle', `scores are ${show(got, run.nameOf)}, the oracle has ${show(want, run.nameOf)}`)
    const most = Math.max(this.config.pointsPerTag, this.config.pointsPerCatch)
    for (const [id, points] of Object.entries(got)) {
      const mine = m.knockouts.filter((k) => k.by === id).length
      if (points < 0 || points > mine * most) run.fail('payouts-within-limits', `${run.nameOf(id)} has ${points} points from ${mine} knockouts`)
    }


    // Secrets: nobody else's task, anywhere but its holder's phone.
    const held = new Map<string, PlayerId[]>()
    for (const [id, task] of Object.entries(run.state<EliminationState>().tasks)) {
      if (!here.has(id)) continue
      held.set(task, [...(held.get(task) ?? []), id])
    }
    if (pub) {
      const strings = stringsIn(pub)
      for (const task of held.keys()) if (strings.has(task)) run.fail('secrets-kept', `a task someone holds is in the public state: “${task}”`)
    }
    const views = run.views()
    for (const p of present) {
      const view = views[p.id] as EliminationPlayerView | undefined
      if (!view) continue
      const strings = stringsIn(view)
      const own = view.status === 'alive' ? view.task : view.status === 'out' ? view.task : null
      for (const [task, holders] of held) {
        if (task !== own && strings.has(task) && !holders.includes(p.id)) {
          run.fail('secrets-kept', `${p.name}'s phone shows another guest's task: “${task}”`)
        }
      }
      if (view.status === 'alive' && m.tasks.get(p.id) !== view.task) run.fail('scores-match-oracle', `${p.name}'s phone shows a task the deal didn't give them`)
      if (view.status !== 'spectator' && !m.dealt.includes(p.id)) run.fail('latecomers-dealt-fairly', `${p.name} plays without being dealt in`)
      if (view.status === 'spectator' && m.dealt.includes(p.id) && !m.left.has(p.id)) run.fail('latecomers-dealt-fairly', `${p.name} was dealt in but watches`)
    }
    for (const item of run.party.feed) {
      if (item.audience !== null) continue
      const text = `${item.message} ${item.detail ?? ''}`
      for (const task of held.keys()) {
        if (text.includes(task) && item.created_at === run.party.now) run.fail('secrets-kept', `a room-wide announcement names a task someone holds: “${task}”`)
      }
    }
  }

  finished() {
    const { run } = this
    const here = new Set(run.present().map((p) => p.id))
    const winner = this.winnerOf(this.model, here)
    const want = winner ? [winner] : []
    const got = run.party.game(run.gameId).winners
    if (!sameSet(got, want)) {
      run.fail('winners-match-oracle', `Last one standing crowned ${got.map(run.nameOf).join(', ') || 'nobody'}, the oracle ${want.map(run.nameOf).join(', ') || 'nobody'}`)
    }
  }
}
