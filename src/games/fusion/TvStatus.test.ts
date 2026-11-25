// Participant fusion's status on the TV (TvStatus), rendered to static HTML
// under Node: the strap's words while it holds the stage, its line in the band
// and its card while another screen does. Counts and names only once revealed.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it } from 'vitest'
import type { FusionPublicPicture, FusionPublicState, FusionReveal } from '@/games/fusion/shapes'
import TvStatus from '@/games/fusion/TvStatus'
import type { TvStatusVariant } from '@/games/types'
import type { Player, SessionGame } from '@/lib/types'

const NOW = 1_000_000
const players: Player[] = ['Mads', 'Ida', 'Ana', 'Bo'].map((name, i) => ({ id: `p${i}`, name, code: `C${i}`, profile: {}, created_at: 0 }))
const REVEAL: FusionReveal = { people: ['p0', 'p1'], names: ['Mads', 'Ida'], both: 9, one: 6, none: 6, voters: 21, originals: [null, null], step: 1, at: NOW - 5000 }

const picture = (n: number, revealed: FusionReveal | null = null): FusionPublicPicture => ({ n, key: `p${n}`, label: `#${n}`, image: null, revealed })
const state = (patch: Partial<FusionPublicState> = {}): FusionPublicState => ({
  phase: 'lobby',
  pictures: Array.from({ length: 12 }, (_, i) => picture(i + 1)),
  rules: { seconds: 30, showSeconds: 6, perPerson: 1, bothBonus: 1 },
  showing: null,
  current: null,
  top: [],
  ...patch,
})
const withRevealed = (count: number) => Array.from({ length: 12 }, (_, i) => picture(i + 1, i < count ? { ...REVEAL, step: i + 1 } : null))

const game = (status: SessionGame['status'] = 'active'): SessionGame => ({
  id: 'g1',
  game_type: 'fusion',
  title: 'Who is fused?',
  position: 0,
  status,
  public_state: null,
  started_at: NOW - 60_000,
  finished_at: null,
  finished_by: null,
  winners: [],
  wake_at: null,
  archived_at: null,
  created_at: 0,
})

async function text(variant: TvStatusVariant, publicState: unknown, extra: { tallies?: Record<string, number>; status?: SessionGame['status'] } = {}) {
  const errors: unknown[] = []
  const props = { game: game(extra.status), players, publicState, gamePoints: {}, tallies: extra.tallies ?? {}, serverNow: () => NOW, variant }
  const { prelude } = await prerender(createElement(TvStatus as ComponentType<never>, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  const html = (await new Response(prelude).text()).replaceAll('<!-- -->', '')
  return { html, words: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
}

describe("fusion's strap words", () => {
  it.each([
    ['12 pictures, starting soon', state()],
    ['Showing 3 of 12', state({ phase: 'showing', showing: { startedAt: NOW - 15_000, endsAt: NOW + 57_000 } })],
    ['All 12 pictures', state({ phase: 'wall' })],
    ['4 of 12 revealed', state({ phase: 'wall', pictures: withRevealed(4) })],
    ['Picture 4 of 12', state({ phase: 'asking', pictures: withRevealed(3), current: { n: 6, step: 4, key: 'p6', openedAt: NOW, endsAt: NOW + 30_000, revealedAt: null } })],
    ['Final result', state({ phase: 'done' })],
    ['Getting ready', null],
    // The background version's locked round reads as the lobby.
    ['2 pictures, starting soon', { phase: 'locked', pictures: [{ n: 1, label: '#1' }, { n: 2, label: '#2' }], scoring: { perPerson: 1, bothBonus: 0 } }],
  ])('%s', async (expected, publicState) => {
    expect((await text('strap', publicState)).words).toBe(expected)
  })

  it('says Final result once the round has finished', async () => {
    expect((await text('strap', state({ phase: 'wall' }), { status: 'finished' })).words).toBe('Final result')
  })
})

describe("fusion's band line and card", () => {
  const asking = state({ phase: 'asking', pictures: withRevealed(3), current: { n: 4, step: 4, key: 'p4', openedAt: NOW, endsAt: NOW + 30_000, revealedAt: null } })
  const revealed = state({
    phase: 'reveal',
    pictures: withRevealed(4),
    current: { n: 4, step: 4, key: 'p4', openedAt: NOW - 40_000, endsAt: NOW - 10_000, revealedAt: NOW - 8000 },
  })

  it.each([
    ['band', 'Who is fused? Starting soon', state()],
    ['band', 'Who is fused? Showing 3 of 12', state({ phase: 'showing', showing: { startedAt: NOW - 15_000, endsAt: NOW + 57_000 } })],
    ['band', 'Who is fused? 4 of 12 revealed', state({ phase: 'wall', pictures: withRevealed(4) })],
    ['band', 'Who is fused? 14 have locked in on #4', asking],
    ['band', 'Who is fused? #4 was Mads and Ida', revealed],
    ['card', 'Who is fused? 4 of 12 revealed', state({ phase: 'wall', pictures: withRevealed(4) })],
    ['card', 'Who is fused? 14 have locked in on #4', asking],
    ['card', 'Who is fused? #4 was Mads and Ida', revealed],
  ] as const)('%s: %s', async (variant, expected, publicState) => {
    expect((await text(variant, publicState, { tallies: { p4: 14 } })).words).toBe(expected)
  })

  it('says one guest has locked in', async () => {
    expect((await text('band', asking, { tallies: { p4: 1 } })).words).toBe('Who is fused? 1 has locked in on #4')
  })

  it('names nobody in a picture before its reveal', async () => {
    const { html } = await text('band', asking, { tallies: { p4: 14 } })
    for (const name of ['Mads', 'Ida', 'Ana', 'Bo']) expect(html).not.toContain(name)
  })
})
