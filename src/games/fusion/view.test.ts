import { describe, expect, it } from 'vitest'
import { voteSpec } from '@/games/fusion/shapes'
import { choiceOf, guessOptions, nameOf, ownName, namesFor, pickSignature, playerNamed, shortName, shortNames, togglePick } from '@/games/fusion/view'
import type { Player } from '@/lib/types'

const player = (id: string, name = id): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0 })

describe('votes', () => {
  it('reads a two-name vote and nothing else', () => {
    expect(choiceOf({ choice: ['Ana', 'Bo'] })).toEqual(['Ana', 'Bo'])
    expect(choiceOf({ choice: ['Ana'] })).toBeNull()
    expect(choiceOf({ value: 3 })).toBeNull()
    expect(choiceOf(undefined)).toBeNull()
  })

  it('compares picks whatever their order and spelling', () => {
    expect(pickSignature(['Bo', 'Ana'])).toBe(pickSignature(['ana', 'bo']))
    expect(pickSignature(null)).toBe('')
  })

  it('picks two at most, a third replacing the oldest; a name picked again in another case drops it', () => {
    expect(togglePick([], 'Ana')).toEqual(['Ana'])
    expect(togglePick(['Ana'], 'Bo')).toEqual(['Ana', 'Bo'])
    expect(togglePick(['Ana', 'Bo'], 'Cy')).toEqual(['Bo', 'Cy'])
    expect(togglePick(['Ana', 'Bo'], 'Ana')).toEqual(['Bo'])
    expect(togglePick(['Ana', 'Bo'], 'ana')).toEqual(['Bo'])
  })
})

describe('the names a guess offers', () => {
  it('lists the names the guess offers, A to Z the Danish way, never your own', () => {
    const spec = voteSpec(['Zelda', 'Åse', 'Sofie', 'Bo', 'Ørn', 'Ana'])
    expect(guessOptions(spec, [], 'Sofie')).toEqual(['Ana', 'Bo', 'Zelda', 'Ørn', 'Åse'])
    // Your own name in another spelling is yours too.
    expect(guessOptions(spec, [], 'sofie ')).toEqual(['Ana', 'Bo', 'Zelda', 'Ørn', 'Åse'])
  })

  it('offers your own name too in teams, where it counts (ownName)', () => {
    const spec = voteSpec(['Sofie', 'Bo', 'Ana'])
    const sofie = player('me', 'Sofie')
    expect(ownName({ team_play: false }, sofie)).toBe('Sofie')
    expect(ownName({}, sofie)).toBe('Sofie')
    expect(ownName({ team_play: true }, sofie)).toBeNull()
    expect(guessOptions(spec, [], ownName({ team_play: true }, sofie))).toEqual(['Ana', 'Bo', 'Sofie'])
  })

  it('falls back to the guests here for a prompt from before names', () => {
    const players = [player('1', 'Mads'), player('2', 'Anna'), player('me', 'Sofie')]
    expect(guessOptions({ kind: 'choice', options: 'guests', min: 2, max: 2 }, players, 'Sofie')).toEqual(['Anna', 'Mads'])
    expect(guessOptions(undefined, players, 'Sofie')).toEqual(['Anna', 'Mads'])
  })

  it('searches like an autocomplete: names that start with the search come first', () => {
    const names = ['Ana', 'Asta', 'Christoffer Bjørnskov', 'Clara', 'Lars']
    // "a": Ana and Asta start with it; Clara and Lars only contain it.
    expect(namesFor(names, 'a')).toEqual(['Ana', 'Asta', 'Clara', 'Lars'])
    // A later word counts before a plain contains: "bj" finds the surname.
    expect(namesFor(names, 'bj')).toEqual(['Christoffer Bjørnskov'])
    // Only contains: in the order given.
    expect(namesFor(names, 'r')).toEqual(['Christoffer Bjørnskov', 'Clara', 'Lars'])
    // Accents and Nordic letters fold: "soren" finds Søren.
    expect(namesFor(['Søren', 'Bo'], 'soren')).toEqual(['Søren'])
    expect(namesFor(names, '')).toEqual(names)
  })

  it('calls a name by its first name on the picker, or the whole name where a first name is shared', () => {
    const names = shortNames(['Christoffer Bjørnskov', 'Anna Holm', 'anna  Berg', 'Marie-Louise Christensen', 'Bo'])
    expect([...names.values()]).toEqual(['Christoffer', 'Anna Holm', 'anna  Berg', 'Marie-Louise', 'Bo'])
    expect(shortName(names, 'christoffer bjørnskov')).toBe('Christoffer')
    expect(shortName(names, 'Zelda Smith')).toBe('Zelda')
  })

  it('finds the guest here a name belongs to, for their photo and token, and nobody for a name nobody joined with', () => {
    const players = [player('1', 'Ana Maria'), player('2', 'Bo')]
    expect(playerNamed(players, 'anamaría')?.id).toBe('1')
    expect(playerNamed(players, 'Zelda')).toBeUndefined()
  })

  it('names players by id, else a placeholder', () => {
    expect(nameOf([player('1', 'Mads')], '1')).toBe('Mads')
    expect(nameOf([], '1')).toBe('A guest')
  })
})
