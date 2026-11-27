// The TV renders every fixture scene (src/lib/fixtures.ts, docs/engine-v2.md
// 5.11) and the TV's own dev scenes, and says what is on: rendered to static
// HTML under Node, so no effects run. Fit is checked in a browser instead
// (the screenshots at 1920 by 1080, 1440 by 900 and 1280 by 720 with 1, 6,
// 12, 24 and 45 guests).
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it, vi } from 'vitest'
import { devTv } from '@/components/tv/devFixture'
import PairingScreen from '@/components/tv/PairingScreen'
import RecapScene from '@/components/tv/RecapScene'
import { recapSlides } from '@/components/tv/recapSlides'
import TvScreen from '@/components/tv/TvScreen'
import { knockedOutIds } from '@/games/registry'
import { FIXTURE_SESSION_ID, fixtureRecapDoc } from '@/lib/fixtures'
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

/** The programme strap's words, tab first: "Next | Quiz then Who is fused?". */
function strapOf(page: string): string {
  const start = page.indexOf('data-frame="strap"')
  if (start < 0) return ''
  const words = page
    .slice(start, page.indexOf('data-frame="bug"'))
    .replace(/^[^>]*>/, '')
    .replace(/<[^>]*$/, '')
    .split(/<[^>]+>/)
    .filter((part) => part.trim() !== '')
  return [words[0], words.slice(1).join('').trim()].join(' | ')
}

describe('the TV scene for each fixture', () => {
  it.each([
    ['fixture=lobby', 'Next | Last one standing then Quiz'],
    ['fixture=quiz-question', 'Quiz | Question 3 of 10'],
    ['fixture=quiz-reveal', 'Quiz | Question 3 of 10'],
    ['fixture=quiz-leaderboard', 'Quiz | After question 3 of 10'],
    ['fixture=fusion-lobby', 'Who is fused? | 12 pictures, starting soon'],
    ['fixture=fusion-start', 'Who is fused? | 12 pictures'],
    ['fixture=fusion-start-2', 'Who is fused? | 2 pictures'],
    ['fixture=fusion-wall', 'Who is fused? | 3 of 12 revealed'],
    ['fixture=fusion-hop', 'Who is fused? | Picture 4 of 12'],
    ['fixture=fusion-wall-40', 'Who is fused? | 15 of 40 revealed'],
    ['fixture=fusion-asking', 'Who is fused? | Picture 4 of 12'],
    ['fixture=fusion-asking-you', 'Who is fused? | Picture 4 of 12'],
    ['fixture=fusion-reveal', 'Who is fused? | Picture 4 of 12'],
    ['fixture=fusion-crown', 'Who is fused? | 12 of 12 revealed'],
    ['fixture=fusion-final', 'Who is fused? | Final result'],
    // The background version's rounds read as a lobby that never starts.
    ['fixture=fusion-legacy', 'Who is fused? | 6 pictures, starting soon'],
    ['fixture=final', 'Last one standing | The final knockout'],
    ['fixture=background', 'Quiz | Question 3 of 10'],
    ['fixture=archived', 'The end | Final standings'],
    ['fixture=standings', 'Next | Quiz then Who is fused?'],
    ['fixture=between', 'Standings | The scoreboard'],
    ['fixture=pong', 'Beer pong | Played in person'],
    ['fixture=pong-final', 'Beer pong | Final result'],
    ['fixture=background&players=45', 'Quiz | Question 3 of 10'],
    ['fixture=final&players=45', 'Last one standing | The final knockout'],
    ['fixture=fusion-final', 'Who is fused? | Final result'],
  ])('%s: the programme strap says what is on', async (search, expected) => {
    expect(strapOf(await html(search))).toBe(expected)
  })

  it.each([
    ['fixture=empty', 'Scan to join'],
    ['fixture=recap', 'the night in numbers'],
    ['fixture=final&players=45', 'Hurra for </span><span class="block whitespace-nowrap">Bo!'],
  ])('%s', async (search, expected) => {
    await expect(html(search)).resolves.toContain(expected)
  })

  it('puts the games running underneath in the band, each in its own line', async () => {
    const page = await html('fixture=background')
    const band = page.slice(page.indexOf('data-frame="band"'), page.indexOf('</footer>'))
    expect(band).toContain('Last one standing')
    expect(band).toContain('Darts')
    expect(band.split('data-fit="band-line"').length - 1).toBe(2)
    // Three games underneath: the oldest keeps its own line and the newer two share Also running, never a third line.
    const between = await html('fixture=between')
    const lines = between.slice(between.indexOf('data-frame="band"'), between.indexOf('</footer>'))
    expect(lines.split('data-fit="band-line"').length - 1).toBe(2)
    expect(lines).toContain('Also running')
    // The recap has no frame: no strap and no band.
    const recap = await html('fixture=recap')
    expect(recap).not.toContain('data-frame="strap"')
    expect(recap).not.toContain('data-frame="band"')
  })

  it("shows a host's own browser as a preview", async () => {
    await expect(html('fixture=lobby&host=1')).resolves.toContain('Host preview')
  })

  it('hides the preview label in the tab Show the TV here opens, since that tab is the TV', async () => {
    const page = await html('fixture=quiz-question&host=1&mirror=1')
    expect(page).not.toContain('Host preview')
    expect(page).toContain('Join with')
  })

  it('keeps the way in to an open party', async () => {
    await expect(html('fixture=lobby')).resolves.toContain('Scan to join')
    await expect(html('fixture=quiz-question')).resolves.toContain('Join with')
    await expect(html('fixture=archived')).resolves.not.toContain('Scan to join')
    await expect(html('fixture=archived')).resolves.not.toContain('data-fit="join"')
    await expect(html('fixture=archived')).resolves.not.toContain('data-fit="invite"')
  })

  it("shows the way in once: the board's join block while the standings show, the band's code while a game holds the stage", async () => {
    const count = (page: string, text: string) => page.split(text).length - 1
    for (const players of [2, 4, 45]) {
      const board = await html(`fixture=standings&players=${players}`)
      expect(count(board, 'Scan to join')).toBe(1)
      expect(board).toContain('data-fit="invite"')
      // The band has no code of its own (the board's one-line form stays mounted out of sight).
      expect(board).not.toContain('data-fit="join"')
    }
    // A game on the stage keeps only the band's code, whatever the party's size.
    const stage = await html('fixture=quiz-question&players=2')
    expect(count(stage, 'Join with')).toBe(1)
    expect(stage).not.toContain('data-fit="invite"')
  })

  it("never cuts the board's join address short: the short form gives it a line of its own", async () => {
    for (const players of [12, 45]) {
      const page = await html(`fixture=standings&players=${players}`)
      // The QR block's and the short form's, one of them kept mounted out of sight.
      const lines = [...page.matchAll(/<(p|span) class="([^"]*)">at hurra\.test<\/\1>/g)]
      expect(lines).toHaveLength(2)
      for (const [, , className] of lines) expect(className).not.toContain('truncate')
    }
  })

  it('groups a small party\'s board into two blocks with a clear middle, and leaves a bigger board as it was', async () => {
    // Everyone fits beside the leader: their block, and the join block against the right edge.
    const small = await html('fixture=standings&players=2')
    expect(small).toContain('data-board-group="leader"')
    expect(small).toContain('data-board-group="side"')
    // A field of rows beside the leader keeps the full-width columns.
    expect(await html('fixture=standings&players=24')).not.toContain('data-board-group')
  })

  it('puts the word Out in pink beside every guest the live hunt has knocked out on the standings board', async () => {
    for (const search of ['fixture=between&players=12', 'fixture=pong&players=12']) {
      const setup = devTv(new URLSearchParams(search))!
      const out = knockedOutIds(setup.snapshot.games)
      const names = setup.snapshot.players.filter((p) => out.has(p.id)).map((p) => p.name)
      const page = await html(search)
      // Static HTML has the rows that need no measuring: the places under the hero.
      const shown = names.filter((name) => page.includes(`>${name}</span>`))
      expect(shown.length, search).toBeGreaterThan(0)
      for (const name of shown) {
        // The name's row (not its token's slate) carries the word.
        const rows = page.split(`>${name}</span>`).slice(1)
        expect(rows.some((after) => /^.{0,240}?text-pink[^"]*">Out</s.test(after)), `${search}: ${name}`).toBe(true)
      }
    }
  })

  it('crowns every guest tied for first on the podium, not only the middle step', async () => {
    const crowns = (page: string) => page.split('data-crown').length - 1
    // With 45 guests, Felix and Luna share first place on 12 points.
    expect(crowns(await html('fixture=standings&players=45'))).toBe(2)
    expect(crowns(await html('fixture=standings&players=24'))).toBe(1)
  })

  it('puts no guest in the hero spot before anyone has scored: the party, "Nobody has scored yet", no rank and no gold', async () => {
    for (const players of [2, 12, 45]) {
      const page = await html(`fixture=standings-zero&players=${players}`)
      const stage = page.slice(page.indexOf('data-frame="stage"'), page.indexOf('data-frame="band"') > 0 ? page.indexOf('data-frame="band"') : undefined)
      expect(stage).toContain('data-board-hero="nobody"')
      expect(stage.replace(/<[^>]*>/g, ' ')).toMatch(/Birthday party\s+Nobody has scored yet/)
      // The first name in A to Z leads nothing: no crown, no gold, and no rank of 1 for everyone.
      expect(stage).not.toContain('data-crown')
      expect(stage).not.toContain('text-gold')
      expect(stage).not.toMatch(/tv-num text-tv-name[^"]*text-paper-3">1</)
      // Ana, the first in A to Z, stands among the places, not as the hero.
      expect(stage).toMatch(/data-fit="place"[^]*>Ana</)
    }
    // Once someone has points, the leader is the hero again.
    const scored = await html('fixture=standings&players=12')
    expect(scored).not.toContain('data-board-hero="nobody"')
    expect(scored).toContain('data-crown')
  })

  it("cheers a game's winner with the screen's one exclamation mark and saves the third hurra for the night's winner", async () => {
    for (const search of ['fixture=final', 'fixture=pong-final']) {
      const page = await html(search)
      expect(page.replace(/<[^>]*>/g, '')).toMatch(/Hurra for \w+!/)
      expect(page).toContain('The third hurra is saved for the night')
      expect(page).toContain('data-tv-field')
      // Over the field the frame's strap tab stands on ink and the bug's words turn ink.
      expect(page).toContain('group/frame')
      expect(page).toMatch(/data-frame="strap"[^>]*>(\s*<span aria-hidden="true" class="stripes[^"]*"><\/span>)?\s*<span class="[^"]*group-has-\[\[data-tv-field\]\]\/frame:bg-ink/)
      expect(page.split('group-has-[[data-tv-field]]/frame:text-ink').length - 1).toBe(2)
    }
  })

  it("shows Participant fusion's phases on the stage, and an old round from before the update safely as its lobby", async () => {
    for (const [scene, phase] of [
      ['fusion-lobby', 'lobby'],
      ['fusion-start', 'wall'],
      ['fusion-wall', 'wall'],
      ['fusion-hop', 'asking'],
      ['fusion-asking', 'asking'],
      ['fusion-reveal', 'reveal'],
      ['fusion-crown', 'wall'],
      ['fusion-legacy', 'lobby'],
    ]) {
      await expect(html(`fixture=${scene}`)).resolves.toContain(`data-fusion-phase="${phase}"`)
    }
  })

  it("crowns fusion's face detective on the winner's screen, with the best disguise at its reveal's time", async () => {
    const page = (await html('fixture=fusion-final')).replace(/<[^>]*>/g, '')
    expect(page).toMatch(/Hurra for \w+!/)
    expect(page).toMatch(/The sharpest eyes?, with \d+ points?( each)?\./)
    expect(page).toMatch(/Best disguise: #\d+\. (Only \d+ of \d+|Nobody) saw \w+ and \w+\./)
    expect(page).toContain('The third hurra is saved for the night')
  })

  it("wears the hunt's pink on its programme strap: stripes and a pink tab, its words pink on ink over its winner's colour", async () => {
    const strapOf = (page: string) => page.slice(page.indexOf('data-frame="strap"'), page.indexOf('data-frame="bug"'))
    for (const search of ['fixture=hunt', 'fixture=final']) {
      const strap = strapOf(await html(search))
      expect(strap).toContain('class="stripes')
      expect(strap).toContain('bg-pink')
      expect(strap).toContain('group-has-[[data-tv-field]]/frame:text-pink')
      expect(strap).not.toContain('bg-gold')
    }
    // Any other game on the stage keeps the gold tab of what is on air, gold on ink over its winner's colour.
    for (const search of ['fixture=quiz-question', 'fixture=pong-final']) {
      const strap = strapOf(await html(search))
      expect(strap).not.toContain('class="stripes')
      expect(strap).toContain('bg-gold')
      expect(strap).toContain('group-has-[[data-tv-field]]/frame:text-gold')
    }
  })

  it("speaks Participant fusion in the frame's language: no exclamation marks, no violet or glow, nothing under the floor", async () => {
    for (const search of ['fixture=fusion-start', 'fixture=fusion-wall', 'fixture=fusion-hop', 'fixture=fusion-asking', 'fixture=fusion-reveal']) {
      const page = await html(search)
      const stage = page.slice(page.indexOf('data-frame="stage"'), page.indexOf('data-frame="band"'))
      expect(stage, search).toContain('data-frame="stage"')
      expect(stage.replace(/<[^>]*>/g, ''), search).not.toContain('!')
      expect(stage, search).not.toMatch(/confetti-violet|radial-gradient|drop-shadow|ring-\d|text-(xs|sm|base|lg|xl|[2-9]xl)\b/)
    }
  })

  it('draws nothing for a screen that may not read the party: the page shows pairing instead', async () => {
    await expect(html('fixture=removed')).resolves.toBe('')
  })
})

describe("the recap's final podium", () => {
  it("cheers the night's winners in the frame's language: no exclamation mark, no glow or rings, nothing under the floor", async () => {
    const doc = fixtureRecapDoc()
    const startAt = recapSlides(doc).findIndex((slide) => slide.kind === 'podium')
    expect(startAt).toBeGreaterThan(0)
    const { prelude } = await prerender(createElement(RecapScene, { doc, partyName: 'Birthday party', startAt }))
    const page = (await new Response(prelude).text()).replaceAll('<!-- -->', '')
    expect(page).toContain('Hurra for Bo, Freja and Maja')
    expect(page.replace(/<[^>]*>/g, '')).not.toContain('!')
    const off = page.match(/.{0,80}(drop-shadow|text-shadow|ring-[1-9]|from-gold|text-primary|text-(xs|sm|base|lg|xl|2xl|3xl)\b).{0,20}/)
    expect(off?.[0]).toBeUndefined()
    // Paper steps, the winners' points on gold.
    expect(page).toContain('bg-paper')
    expect(page).toContain('rounded-chip bg-gold')
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
