// The order of the join page (docs/guest-photos.md, 6.1 and 8.1, and
// docs/guest-list.md, 6). The camera app and the photo picker hide the page,
// and a Wi-Fi blip fires `online`: either makes the membership reload, which
// then finds the new player, or waits out a busy sign-in. The step must hold
// through both. The real events are checked by hand on Android (8.4): the
// repo has no DOM test environment.
import { describe, expect, it } from 'vitest'
import { freedNameOf, freedNote, joinScreen, openScreen, type Joined } from '@/pages/joinScreen'

const joined: Joined = {
  party: { id: 'p', name: 'Birthday party', join_code: 'HURRA30', status: 'open', archived_at: null },
  player: { id: 'a', session_id: 'p', user_id: 'u', name: 'Ana', code: 'A4N7Q', profile: {}, created_at: '2026-11-28T19:00:00Z' },
}

describe('joinScreen', () => {
  it('shows the photo step to the guest who just joined here, whether or not the reload is busy or has found the player', () => {
    expect(joinScreen(joined, false)).toEqual({ kind: 'step', joined })
    expect(joinScreen(joined, true)).toEqual({ kind: 'step', joined })
  })

  it('else the busy screen while the sign-in waits, else the gate', () => {
    expect(joinScreen(null, true)).toEqual({ kind: 'busy' })
    expect(joinScreen(null, false)).toEqual({ kind: 'gate' })
  })
})

describe('openScreen: which screen an open party shows', () => {
  const names = ['Ana', 'Bo', 'Zelda']

  it('the loader while the free names load', () => {
    expect(openScreen(undefined, null, false)).toEqual({ kind: 'loading' })
  })

  it("today's name form for a party without a list, or when the names couldn't be read", () => {
    expect(openScreen([], null, false)).toEqual({ kind: 'form', backToList: false })
  })

  it('Who are you? when there are free names, and You’re Ana? for a name tapped there', () => {
    expect(openScreen(names, null, false)).toEqual({ kind: 'list', names })
    expect(openScreen(names, 'Ana', false)).toEqual({ kind: 'confirm', name: 'Ana' })
    // The poll may drop the name meanwhile: the confirm stays, and the claim says so.
    expect(openScreen(['Bo'], 'Ana', false)).toEqual({ kind: 'confirm', name: 'Ana' })
  })

  it("I'm not on the list: the name form with Back to the list", () => {
    expect(openScreen(names, null, true)).toEqual({ kind: 'form', backToList: true })
    expect(openScreen(names, 'Ana', true)).toEqual({ kind: 'form', backToList: true })
    // Every name taken meanwhile: nothing to go back to.
    expect(openScreen([], null, true)).toEqual({ kind: 'form', backToList: false })
  })
})

describe('a phone whose name the host freed', () => {
  it('reads the name from the router state the phone home leaves, and nothing else', () => {
    expect(freedNameOf({ freed: 'Ana' })).toBe('Ana')
    for (const state of [null, undefined, 'Ana', {}, { freed: '' }, { freed: '  ' }, { freed: 3 }]) {
      expect(freedNameOf(state)).toBeNull()
    }
  })

  it('says the name went back to the list', () => {
    expect(freedNote('Ana')).toBe('The host gave the name Ana back to the list. Pick your own name.')
  })
})
