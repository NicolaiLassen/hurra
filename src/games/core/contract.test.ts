import { describe, expect, it } from 'vitest'
import { botExample, checkGameContract, type ContractExample } from './contract'
import type { GameContext, PlayerId } from './Game'
import { ProbeGame, type ProbeConfig, type ProbePublicState, type ProbeState } from './probe'

const probe = new ProbeGame()

/** A round of the probe that touches every check: moves, a question with a timer reveal, a join and a leave. */
const example: ContractExample = {
  config: { movesToWin: 4, seconds: 5 },
  players: 4,
  steps: [
    { kind: 'action', player: 0, action: { type: 'move' } },
    { kind: 'host', action: { type: 'ask', step: 0 } },
    { kind: 'answer', player: 1, key: 'q1', answer: { choice: ['yes'] }, afterMs: 1200 },
    { kind: 'answer', player: 2, key: 'q1', answer: { choice: ['no'] }, afterMs: 2500 },
    { kind: 'join' },
    { kind: 'tick', ms: 6000 },
    { kind: 'sync' },
    { kind: 'leave', player: 3 },
    { kind: 'host', action: { type: 'ask', step: 1 } },
    { kind: 'answer', player: 4, key: 'q2', answer: { choice: ['yes'] }, afterMs: 100 },
    { kind: 'host', action: { type: 'reveal', step: 2 }, close: ['q2'] },
    { kind: 'action', player: 1, action: { type: 'move' } },
    { kind: 'action', player: 4, action: { type: 'steal' } },
    { kind: 'action', player: 2, action: { type: 'move' } },
    { kind: 'action', player: 0, action: { type: 'move' } },
  ],
}

describe('checkGameContract', () => {
  it('passes the probe game through a whole round', () => {
    expect(checkGameContract(probe, example)).toEqual([])
  })

  it('asks for a join and a leave in every example', () => {
    expect(checkGameContract(probe, { config: {}, players: 2, steps: [{ kind: 'end' }] })).toEqual([
      'The example needs a join step',
      'The example needs a leave step',
    ])
  })

  it('finds projections that depend on object key order', () => {
    type Keyed = ProbeState & { seat: Record<PlayerId, number> }
    class KeyOrder extends ProbeGame {
      setup(ctx: GameContext<ProbeConfig>): ProbeState {
        // Keyed by player in deal order, read back with Object.keys: jsonb reorders the keys.
        return { ...super.setup(ctx), seat: Object.fromEntries(ctx.players.map((p, i) => [p.id, i])) } as Keyed
      }
      publicState(state: ProbeState): ProbePublicState {
        return { ...super.publicState(state), order: Object.keys((state as Keyed).seat) } as ProbePublicState
      }
    }
    const problems = checkGameContract(new KeyOrder(), example)
    expect(problems.some((p) => p.includes('object key order'))).toBe(true)
  })

  it('finds a hook that mutates its input', () => {
    class Mutates extends ProbeGame {
      handleAction(state: ProbeState, _action: unknown, playerId: PlayerId, ctx: GameContext<ProbeConfig>): ProbeState {
        state.moves.push({ by: playerId, at: ctx.now })
        return state
      }
    }
    const problems = checkGameContract(new Mutates(), example)
    expect(problems.some((p) => /read only|not extensible|Cannot add property/i.test(p))).toBe(true)
  })

  it('finds a wake that never moves forward', () => {
    class Stuck extends ProbeGame {
      onWake(state: ProbeState): ProbeState {
        return state
      }
    }
    const problems = checkGameContract(new Stuck(), example)
    expect(problems.some((p) => p.includes('wake'))).toBe(true)
  })

  it('finds a recap that tells a round still running', () => {
    class Leaky extends ProbeGame {
      recap() {
        return [{ title: 'Spoiler' }]
      }
    }
    const problems = checkGameContract(new Leaky(), example)
    expect(problems.some((p) => p.includes('recap() returned highlights for a round still running'))).toBe(true)
  })
})

describe('botExample', () => {
  it('records a round a bot plays, with a join and a leave, that the contract replays', () => {
    const result = botExample(probe, {
      settings: () => ({ movesToWin: 5, seconds: 3 }),
      move: (sight) => (sight.random() < 0.1 ? { kind: 'action', action: { type: 'move' } } : null),
      hostMove: (sight) => {
        const state = sight.state as ProbeState
        return state.question ? null : { action: { type: 'ask', step: state.step } }
      },
    })
    if (!('example' in result)) throw new Error(result.refused)
    const kinds = new Set(result.example.steps.map((s) => s.kind))
    expect([...kinds]).toEqual(expect.arrayContaining(['action', 'host', 'tick', 'join', 'leave']))
    expect(checkGameContract(probe, result.example)).toEqual([])
  })

  it("says so when the game won't start with the bot's settings", () => {
    expect(botExample(probe, { settings: () => ({ movesToWin: 0 }), move: () => null })).toEqual({
      refused: 'movesToWin must be a whole number from 1 to 100',
    })
  })
})
