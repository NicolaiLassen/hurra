// The order of the join page (docs/guest-photos.md, 6.1 and 8.1). The camera
// app and the photo picker hide the page, and a Wi-Fi blip fires `online`:
// either makes the membership reload, which then finds the new player, or
// waits out a busy sign-in. The step must hold through both. The real events
// are checked by hand on Android (8.4): the repo has no DOM test environment.
import { describe, expect, it } from 'vitest'
import { joinScreen, type Joined } from '@/pages/joinScreen'

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
