// The TV renders every fixture scene (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11) and the TV's own dev scenes, and says what is on: rendered to static
// HTML under Node, so no effects run. Fit is checked in a browser instead
// (the screenshots at 1920 by 1080 and 1440 by 900 with 8, 24 and 45 guests).
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it, vi } from 'vitest'
import { devTv } from '@/components/tv/devFixture'
import PairingScreen from '@/components/tv/PairingScreen'
import TvScreen from '@/components/tv/TvScreen'
import { FIXTURE_SESSION_ID } from '@/lib/fixtures'
import { LiveSessionProvider } from '@/lib/useLive'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
// Game views size their tiles from the root font size while they render.
vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }))
// The sound toggle's setting.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
// The join card's QR code and the empty board's address; motion listens for resizes once it sees a window.
vi.stubGlobal('window', {
  location: { origin: 'https://hurra.test', host: 'hurra.test' },
  addEventListener: () => {},
  removeEventListener: () => {},
})

async function html(search: string): Promise<string> {
  const setup = devTv(new URLSearchParams(search))
  if (!setup) throw new Error(`No fixture for ${search}`)
  const errors: unknown[] = []
  const tree = createElement(LiveSessionProvider, {
    sessionId: FIXTURE_SESSION_ID,
    screen: 'tv',
    fixture: setup.snapshot,
    children: createElement(TvScreen, { hostPreview: setup.hostPreview, fixtureRecap: setup.recap }),
  })
  const { prelude } = await prerender(tree, { onError: (error) => void errors.push(error) })
  if (errors.length > 0) throw errors[0]
  // Text only: React splits adjacent strings with comment markers.
  return (await new Response(prelude).text()).replace(/<!-- -->/g, '')
}

describe('the TV scene for each fixture', () => {
  it.each([
    ['fixture=lobby', 'Live scoreboard'],
    ['fixture=quiz-question', 'Now on stage:<span class="font-semibold text-foreground"> Quiz'],
    ['fixture=quiz-reveal', 'Now on stage:'],
    ['fixture=quiz-leaderboard', 'Now on stage:'],
    ['fixture=fusion-voting', 'Live scoreboard'],
    ['fixture=fusion-locked', 'Now on stage:'],
    ['fixture=fusion-reveal', 'Now on stage:'],
    ['fixture=final', 'Final result:'],
    ['fixture=background', 'Also running'],
    ['fixture=archived', 'Final standings'],
    ['fixture=standings', 'Last game:'],
    ['fixture=between', 'Live scoreboard'],
    ['fixture=pong', 'Now on stage:'],
    ['fixture=pong-final', 'Final result'],
    ['fixture=empty', 'Scan to join'],
    ['fixture=recap', 'the night in numbers'],
    ['fixture=background&players=45', 'Also running'],
    ['fixture=final&players=45', 'is the last one standing'],
  ])('%s', async (search, expected) => {
    await expect(html(search)).resolves.toContain(expected)
  })

  it("shows a host's own browser as a preview", async () => {
    await expect(html('fixture=lobby&host=1')).resolves.toContain('Host preview')
  })

  it('hides the preview label in the tab Show the TV here opens, since that tab is the TV', async () => {
    const page = await html('fixture=lobby&host=1&mirror=1')
    expect(page).not.toContain('Host preview')
    expect(page).toContain('Join the game')
  })

  it('keeps the join card to an open party with guests', async () => {
    await expect(html('fixture=lobby')).resolves.toContain('Join the game')
    await expect(html('fixture=archived')).resolves.not.toContain('Join the game')
  })

  it('draws nothing for a screen that may not read the party: the page shows pairing instead', async () => {
    await expect(html('fixture=removed')).resolves.toBe('')
  })
})

describe('the pairing screen', () => {
  it('names the party and says where the code comes from', async () => {
    const { prelude } = await prerender(createElement(PairingScreen, { partyName: 'Birthday party', onPair: async () => {} }))
    const page = await new Response(prelude).text()
    expect(page).toContain('Birthday party')
    expect(page).toContain('Pair this screen')
    expect(page).toContain('On the host page, tap Pair a TV and type the code shown there.')
  })
})
