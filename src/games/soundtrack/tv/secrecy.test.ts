// The TV never shows a typed answer, and never a song before its reveal
// (.design/lydspor/spec.md, section 9). Every TV screen of every sample scene
// is rendered to static HTML, as views.test.ts does, and its text is searched
// for each guest's typed answers and for the unrevealed songs' titles,
// singers and captions. Effects don't run under Node, so the wall (sized by
// measuring) stays empty here: it shows photos and letters only.
import { createElement, type ComponentType } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it, vi } from 'vitest'
import type { Player, SessionGame } from '@/lib/types'
import FinalTvView from '../FinalTvView'
import { normalise } from '../match'
import { SOUNDTRACK_SCENES, soundtrackSample } from '../samples'
import TvStatus from '../TvStatus'
import TvView from '../TvView'

vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }))

const NOW = Date.UTC(2026, 10, 28, 20, 30)
const NAMES = ['Ana', 'Bo', 'Clara', 'Sofie', 'Dag', 'Eik', 'Ida', 'Jon', 'Karl', 'Lise', 'Mads', 'Noah']
const CAST = { players: NAMES.map((name, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name })) }

async function text(view: ComponentType<never>, props: Record<string, unknown>): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(createElement(view, props as never), { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  const html = await new Response(prelude).text()
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

describe.each(SOUNDTRACK_SCENES)('the TV in the %s scene', (scene) => {
  const sample = soundtrackSample(scene, CAST, NOW)
  const players: Player[] = CAST.players.map((p, i) => ({ id: p.id, name: p.name, joined_at: NOW - (60 - i) * 60_000 }) as unknown as Player)
  const done = sample.finishedAt !== null
  const game = {
    id: 'sample',
    game_type: 'soundtrack',
    title: 'Lydspor',
    status: done ? 'finished' : 'active',
    public_state: sample.publicState,
    started_at: sample.startedAt,
    finished_at: sample.finishedAt,
    winners: sample.winners,
  } as unknown as SessionGame
  const screen = {
    session: { id: 'party', name: 'Birthday party', join_code: 'HURRA30' },
    game,
    players,
    publicState: sample.publicState,
    prompts: [],
    serverNow: () => NOW,
    mediaUrl: (path: string) => `/media/${path}`,
    scores: players.map((p, i) => ({ player_id: p.id, name: p.name, points: 30 - i })),
    gamePoints: sample.points,
    tallies: sample.tallies,
    feed: [],
    finished: done,
  }

  const revealed = sample.config.songs.slice(0, sample.publicState.revealed)
  const unrevealed = sample.config.songs.slice(sample.publicState.revealed)
  // A typed answer may match a revealed song's truth, which the TV shows as the truth.
  const truths = revealed.flatMap((song) => [song.title, song.singer]).map(normalise)
  const typed = [...new Set(Object.values(sample.answers).flatMap((mine) => Object.values(mine).flatMap((a) => ('text' in a ? [a.text] : []))))]
  const secret = typed.filter((t) => !truths.some((truth) => truth.includes(normalise(t)) || normalise(t).includes(truth)))

  it('has typed answers to hide', () => {
    if (scene !== 'lobby') expect(secret.length).toBeGreaterThan(5)
  })

  it('shows no typed answer and no song before its reveal', async () => {
    const shown = [
      await text(TvView as ComponentType<never>, screen),
      ...(done ? [await text(FinalTvView as ComponentType<never>, screen)] : []),
      ...(await Promise.all(
        (['card', 'band', 'strap'] as const).map((variant) =>
          text(TvStatus as ComponentType<never>, {
            game,
            players,
            publicState: sample.publicState,
            gamePoints: sample.points,
            tallies: sample.tallies,
            serverNow: () => NOW,
            variant,
          }),
        ),
      )),
    ].join(' | ')
    for (const answer of secret) expect(shown, `typed "${answer}"`).not.toContain(answer)
    for (const song of unrevealed) {
      expect(shown).not.toContain(song.title)
      expect(shown).not.toContain(song.singer)
      expect(shown).not.toContain(song.caption)
    }
  })
})

describe('the reveal on the TV', () => {
  it('shows the song, its caption, the counts and who tells the story', async () => {
    const sample = soundtrackSample('reveal', CAST, NOW)
    const reveal = sample.publicState.reveal!
    const players = CAST.players as unknown as Player[]
    const shown = await text(TvView as ComponentType<never>, {
      session: { id: 'party', name: 'Birthday party' },
      game: { id: 'sample', title: 'Lydspor', status: 'active', winners: [] },
      players,
      publicState: sample.publicState,
      prompts: [],
      serverNow: () => NOW,
      mediaUrl: (path: string) => `/media/${path}`,
      scores: [],
      gamePoints: {},
      tallies: sample.tallies,
      feed: [],
      finished: false,
    })
    expect(shown).toContain(`Song ${reveal.n}`)
    expect(shown).toContain(reveal.title)
    expect(shown).toContain(reveal.singer)
    expect(shown).toContain(reveal.caption)
    expect(shown).toContain(`${reveal.counts.title} of ${reveal.scoring} got the title`)
    expect(shown).toContain(`${reveal.counts.event} of ${reveal.scoring} got the event, photo ${String.fromCharCode(65 + reveal.event)}`)
    expect(shown).toContain(`${sample.config.storyteller} tells the story.`)
  })
})
