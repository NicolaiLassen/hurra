import { describe, expect, it } from 'vitest'
import type { Player, PromptState, Snapshot, Team } from '@/lib/types'
import { answerRule, teamLine, teamSizeLine, teamWords } from './team'

const gold: Team = { id: 'tg', name: 'Team Gold', colour: 'gold', position: 0 }
const pink: Team = { id: 'tp', name: 'Team Pink', colour: 'pink', position: 1 }
const player = (id: string, name: string, team_id: string | null = null): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0, team_id })
const players = [player('ana', 'Ana', 'tg'), player('sofie', 'Sofie', 'tg'), player('bo', 'Bo', 'tp'), player('cy', 'Cy')]

const prompt = (key: string, final: boolean | undefined, patch: Partial<PromptState> = {}): PromptState => ({
  game_id: 'g',
  key,
  spec: final === undefined ? { kind: 'text' } : { kind: 'choice', options: ['0', '1'], final },
  opened_at: 1000,
  closes_at: null,
  closed_at: null,
  revealed_at: null,
  ...patch,
})

type Party = Pick<Snapshot, 'teams' | 'players' | 'prompts' | 'me'>
const party = (patch: Partial<Party> = {}): Party => ({
  teams: [gold, pink],
  players,
  prompts: [prompt('q1', true)],
  me: { player_id: 'sofie', views: {}, answers: {} },
  ...patch,
})
const answeredBy = (by: string, key = 'q1', at = 2000): Party['me'] => ({
  player_id: 'sofie',
  views: {},
  answers: { g: { [key]: { choice: ['1'] } } },
  answered_by: { g: { [key]: { by, at } } },
})

describe('how a team answer counts', () => {
  it('is the first answer when every open prompt is final, the latest when none is', () => {
    expect(answerRule([prompt('q1', true)])).toBe('first')
    expect(answerRule([prompt('t1', undefined), prompt('t2', false)])).toBe('latest')
  })

  it('reads only the open prompts', () => {
    expect(answerRule([prompt('q1', false, { closed_at: 1500 }), prompt('q2', true)])).toBe('first')
    expect(answerRule([prompt('q1', true, { closed_at: 1500 })])).toBeNull()
    expect(answerRule([])).toBeNull()
  })

  it('says neither for a mix of final and open prompts', () => {
    expect(answerRule([prompt('q1', true), prompt('t1', undefined)])).toBeNull()
  })
})

describe('the team line words', () => {
  it('says the team answers together and how it counts', () => {
    expect(teamWords(gold, 'first', null)).toEqual({
      head: 'Team Gold answers together.',
      rule: 'Any of you can answer: the first answer counts for all of you.',
      answered: null,
    })
    expect(teamWords(gold, 'latest', null).rule).toBe('Any of you can answer, and the latest answer counts.')
    expect(teamWords(gold, null, null).rule).toBe('One answer from any of you counts for all of you.')
  })

  it('says who gave the newest answer, "You" for this phone, and "A teammate" for one who left', () => {
    expect(teamWords(gold, 'first', { by: { name: 'Ana' }, mine: false }).answered).toBe('Ana answered for your team.')
    expect(teamWords(gold, 'first', { by: { name: 'Sofie' }, mine: true }).answered).toBe('You answered for your team.')
    expect(teamWords(gold, 'latest', { by: null, mine: false }).answered).toBe('A teammate answered for your team.')
  })

  it('never uses a dash', () => {
    for (const rule of ['first', 'latest', null] as const) {
      const words = teamWords(gold, rule, { by: { name: 'Ana' }, mine: false })
      expect(Object.values(words).join(' ')).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('when a phone shows the team line', () => {
  const game = { id: 'g', team_play: true }

  it('shows for a guest in a team while the game is played in teams', () => {
    const line = teamLine(party(), game, 'sofie')
    expect(line?.team).toBe(gold)
    expect(line?.words.head).toBe('Team Gold answers together.')
    expect(line?.words.rule).toBe('Any of you can answer: the first answer counts for all of you.')
    expect(line?.words.answered).toBeNull()
  })

  it('shows nothing with team play off, in a party without teams, or for a guest in no team', () => {
    expect(teamLine(party(), { id: 'g', team_play: false }, 'sofie')).toBeNull()
    expect(teamLine(party(), { id: 'g' }, 'sofie')).toBeNull()
    expect(teamLine(party({ teams: [] }), game, 'sofie')).toBeNull()
    expect(teamLine(party({ teams: undefined }), game, 'sofie')).toBeNull()
    expect(teamLine(party(), game, 'cy')).toBeNull()
  })

  it('names the teammate who answered for the team, or you', () => {
    expect(teamLine(party({ me: answeredBy('ana') }), game, 'sofie')?.words.answered).toBe('Ana answered for your team.')
    expect(teamLine(party({ me: answeredBy('sofie') }), game, 'sofie')?.words.answered).toBe('You answered for your team.')
  })

  it('reads only this game’s prompts, and forgets an answer once its prompt closes', () => {
    const other = { ...prompt('t1', undefined), game_id: 'other' }
    expect(teamLine(party({ prompts: [prompt('q1', true), other] }), game, 'sofie')?.words.rule).toBe(
      'Any of you can answer: the first answer counts for all of you.',
    )
    const closed = party({ prompts: [prompt('q1', true, { closed_at: 3000 })], me: answeredBy('ana') })
    expect(teamLine(closed, game, 'sofie')?.words).toEqual({
      head: 'Team Gold answers together.',
      rule: 'One answer from any of you counts for all of you.',
      answered: null,
    })
  })
})

describe('teamSizeLine', () => {
  it('counts a team from this guest’s side', () => {
    expect(teamSizeLine(1, true)).toBe('Just you so far')
    expect(teamSizeLine(5, true)).toBe('You and 4 more')
    expect(teamSizeLine(0, false)).toBe('Nobody yet')
    expect(teamSizeLine(1, false)).toBe('1 guest')
    expect(teamSizeLine(6, false)).toBe('6 guests')
  })
})
