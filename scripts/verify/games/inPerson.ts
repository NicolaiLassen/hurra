// The in-person round's oracle: no state and no scores of its own; the host
// gives points by scanning codes (score_events with the round's id), and End
// crowns the top of this round's awards, everyone tied, nobody at 0 or below.
// Awards before the round's start (a restart) don't count for it.
import type { PlayerId } from '../../../src/games/core/Game'
import { sameSet, stringsIn, type Adapter, type HostStep, type Move, type Oracle, type Run } from '../core'

export const inPerson: Adapter = {
  type: 'in-person',
  // The host ends the round when the beer pong is over.
  endChance: 0.006,
  // Anything saved is ignored.
  settings: (run) => (run.rng.chance(0.5) ? {} : { leftover: 'from an older editor', points: 3 }),
  begin: (run) => new InPersonOracle(run),
}

class InPersonOracle implements Oracle {
  /** This round's awards per guest here. */
  private readonly awards = new Map<PlayerId, number>()

  private readonly run: Run

  constructor(run: Run) {
    this.run = run
  }

  guest(): Move | null {
    // Guests never act on their phones; now and then one tries, and is told the host scores it.
    return this.run.rng.chance(0.01) ? { kind: 'action', action: { type: 'score' }, note: 'refused: the host scores it' } : null
  }

  host(): HostStep | null {
    // No host controls; the round ends with End, which the driver sends now and then.
    if (this.run.rng.chance(0.01)) return { action: { type: 'next' }, note: 'refused: no host controls' }
    return null
  }

  answered() {}

  dropped(playerId: PlayerId) {
    this.awards.delete(playerId)
  }

  awarded(playerId: PlayerId, points: number, gameId: string | null) {
    if (gameId === this.run.gameId) this.awards.set(playerId, (this.awards.get(playerId) ?? 0) + points)
  }

  after() {}

  check() {
    const { run } = this
    if (Object.keys(run.scores()).length > 0) run.fail('scores-match-oracle', 'the in-person round has scores of its own')
    const pub = run.publicState<Record<string, unknown>>()
    if (pub && stringsIn(pub).size > 0) run.fail('secrets-kept', 'the in-person round has a public state')
  }

  finished() {
    const { run } = this
    const here = run.present().map((p) => p.id)
    const top = Math.max(0, ...here.map((id) => this.awards.get(id) ?? 0))
    const want = top > 0 ? here.filter((id) => (this.awards.get(id) ?? 0) === top) : []
    const got = run.party.game(run.gameId).winners
    if (!sameSet(got, want)) {
      run.fail('winners-match-oracle', `the round crowned ${got.map(run.nameOf).join(', ') || 'nobody'}, its awards say ${want.map(run.nameOf).join(', ') || 'nobody'}`)
    }
  }
}
