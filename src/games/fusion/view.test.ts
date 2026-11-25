import { describe, expect, it } from 'vitest'
import { candidatesFor, choiceOf, nameOf, pickSignature, shortNames, togglePick } from '@/games/fusion/view'
import type { Player } from '@/lib/types'

const player = (id: string, name = id): Player => ({ id, name, code: 'ABCDE', profile: {}, created_at: 0 })

describe('votes', () => {
  it('reads a two-person vote and nothing else', () => {
    expect(choiceOf({ choice: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(choiceOf({ choice: ['a'] })).toBeNull()
    expect(choiceOf({ value: 3 })).toBeNull()
    expect(choiceOf(undefined)).toBeNull()
  })

  it('compares picks whatever their order', () => {
    expect(pickSignature(['b', 'a'])).toBe(pickSignature(['a', 'b']))
    expect(pickSignature(null)).toBe('')
  })

  it('picks two at most, a third replacing the oldest', () => {
    expect(togglePick([], 'a')).toEqual(['a'])
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePick(['a', 'b'], 'c')).toEqual(['b', 'c'])
    expect(togglePick(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('finding people', () => {
  it('lists everyone but yourself, by name, filtered by a search', () => {
    const players = [player('1', 'Mads'), player('2', 'Anna'), player('3', 'Søren'), player('me', 'Me')]
    expect(candidatesFor(players, 'me', '').map((p) => p.name)).toEqual(['Anna', 'Mads', 'Søren'])
    expect(candidatesFor(players, 'me', 'sor').map((p) => p.name)).toEqual(['Søren'])
    expect(candidatesFor(players, 'me', 'me')).toEqual([])
  })

  it('searches like an autocomplete: names that start with the search come first', () => {
    const players = [
      player('1', 'Clara'),
      player('2', 'Ana'),
      player('3', 'Christoffer Bjørnskov'),
      player('4', 'Asta'),
      player('5', 'Lars'),
      player('me', 'Sofie'),
    ]
    // "a": Ana and Asta start with it; Clara and Lars only contain it.
    expect(candidatesFor(players, 'me', 'a').map((p) => p.name)).toEqual(['Ana', 'Asta', 'Clara', 'Lars'])
    // A later word counts before a plain contains: "bj" finds the surname.
    expect(candidatesFor(players, 'me', 'bj').map((p) => p.name)).toEqual(['Christoffer Bjørnskov'])
    // Only contains: by name.
    expect(candidatesFor(players, 'me', 'r').map((p) => p.name)).toEqual(['Christoffer Bjørnskov', 'Clara', 'Lars'])
  })

  it('calls a guest by their first name on the picker, or their whole name where a first name is shared', () => {
    const names = shortNames([
      player('1', 'Christoffer Bjørnskov'),
      player('2', 'Anna Holm'),
      player('3', 'anna  Berg'),
      player('4', 'Marie-Louise Christensen'),
      player('5', 'Bo'),
    ])
    expect([...names.values()]).toEqual(['Christoffer', 'Anna Holm', 'anna  Berg', 'Marie-Louise', 'Bo'])
  })

  it('names players, falling back to the name a reveal kept', () => {
    expect(nameOf([player('1', 'Mads')], '1')).toBe('Mads')
    expect(nameOf([], '1', 'Anna')).toBe('Anna')
    expect(nameOf([], '1')).toBe('A guest')
  })
})
