import { useMemo } from 'react'
import Backdrop from '@/components/tv/Backdrop'
import Band from '@/components/tv/Band'
import Banner from '@/components/tv/Banner'
import Board from '@/components/tv/Board'
import Corner from '@/components/tv/Corner'
import Header from '@/components/tv/Header'
import Lobby from '@/components/tv/Lobby'
import RecapScene from '@/components/tv/RecapScene'
import { byOldestStart, joinPlace, mainArea, newsStage, sceneLine, strapNews } from '@/components/tv/scene'
import StageView from '@/components/tv/StageView'
import Strip from '@/components/tv/Strip'
import TitleCard from '@/components/tv/TitleCard'
import { useEffectsVolume } from '@/components/tv/useEffectsVolume'
import { useGains } from '@/components/tv/useGains'
import { useNews } from '@/components/tv/useNews'
import { useTitleCard } from '@/components/tv/useTitleCard'
import { accentOf, getGameModule } from '@/games/registry'
import { withRanks } from '@/lib/format'
import { usePublishedRecap } from '@/lib/queries'
import type { RecapDoc } from '@/lib/recap'
import { backgroundGames, recentlyFinished, tvScene, type TvScene } from '@/lib/stage'
import { playedInTeams, teamPoints } from '@/lib/teams'
import type { Session, Snapshot } from '@/lib/types'
import { useLive, useServerNow } from '@/lib/useLive'

const hasTvView = (gameType: string) => !!getGameModule(gameType)?.TvView
const stageBannersOf = (gameType: string) => getGameModule(gameType)?.stageBanners ?? 'banner'

/**
 * The TV once paired (docs/engine-v2.md, 7.2), in its on-air frame
 * (docs/identity.md, The TV's frame): the programme strap and the bug at the
 * top, the stage at full width, and one band at the bottom with the games
 * running in the background and the way in, all inside the 5 percent safe
 * area. The scene from stage.ts decides what fills the stage: a game's own
 * screen, the podium and standings between games, the lobby's QR code before
 * anyone joins; the recap takes the whole screen. Announcements become the
 * news strap across the top, a sound, or the band's event line (news.ts).
 * Reads the nearest LiveSessionProvider, whose snapshot must be a member's.
 */
export default function TvScreen({
  hostPreview,
  fixtureRecap,
  recapSlide,
}: {
  hostPreview: boolean
  /** Dev fixtures: the recap to play, with no network, and the slide to open on. */
  fixtureRecap?: RecapDoc
  recapSlide?: number
}) {
  const { snapshot } = useLive()
  if (!snapshot?.session) return null
  return (
    <Screen snapshot={snapshot} session={snapshot.session} hostPreview={hostPreview} fixtureRecap={fixtureRecap} recapSlide={recapSlide} />
  )
}

function Screen({
  snapshot,
  session,
  hostPreview,
  fixtureRecap,
  recapSlide,
}: {
  snapshot: Snapshot
  session: Session
  hostPreview: boolean
  fixtureRecap?: RecapDoc
  recapSlide?: number
}) {
  const { connected, pings } = useLive()
  const now = useServerNow(1000)
  const scene = tvScene(snapshot, now)
  // The host's sound effects volume for this party: every sound below plays at it.
  useEffectsVolume(session.sound_volume)

  // The recap is read once its scene is on; a fixture brings its own.
  const recapRevision = scene.kind === 'recap' && !fixtureRecap ? (snapshot.recap?.published_at ?? 0) : 0
  const published = usePublishedRecap(session.id, recapRevision)
  const recap = scene.kind === 'recap' ? (fixtureRecap ?? published.data ?? null) : null
  // Until the recap is here (or if it can't be read), the scene underneath it.
  const shown: TvScene = scene.kind === 'recap' && !recap ? tvScene({ ...snapshot, recap: null }, now) : scene
  const area = mainArea(shown, hasTvView)

  const players = snapshot.players
  const ranked = useMemo(() => withRanks(snapshot.standings), [snapshot.standings])
  const gains = useGains(snapshot.standings)
  const over = session.archived_at !== null
  const open = session.status === 'open' && !over
  const join = joinPlace(area, open, ranked.length)

  // The game on the stage, and what runs underneath it.
  const stageId = area.kind === 'stage' ? area.game.id : area.kind === 'board' ? (area.nowPlaying?.id ?? null) : null
  const running = backgroundGames(snapshot)
    .filter((g) => g.id !== stageId)
    .sort(byOldestStart)
  const finished = recentlyFinished(snapshot, now).filter((g) => g.id !== stageId)

  const news = useNews(snapshot.feed, newsStage(area, stageBannersOf))
  const banner = strapNews(news.banner, area)
  const ticker = news.ticker
  const titleCard = useTitleCard(shown, session, now)
  const line = sceneLine(shown, players, snapshot.games)
  // The stage game played in teams: the strap says so, and the band has each team's points in it.
  // The standings stay each guest's own.
  const teamGame = line.game && playedInTeams(snapshot, line.game) ? line.game : null
  const titleOf = (gameId: string | null | undefined) => snapshot.games.find((g) => g.id === gameId)?.title
  const gameTypeOf = (gameId: string | null | undefined) => snapshot.games.find((g) => g.id === gameId)?.game_type

  // The band has the games in the background. Beside the podium, in the room
  // the board leaves: the game on the stage without a screen of its own, and
  // the games that finished lately. The board draws its own join block.
  const nowPlaying = area.kind === 'board' ? area.nowPlaying : null
  const chips = !over && (nowPlaying !== null || finished.length > 0)
  const strip = chips
    ? (room: number, chipsHeight?: number) => (
        <Strip room={room} chipsHeight={chipsHeight} nowPlaying={nowPlaying} running={[]} finished={finished} players={players} />
      )
    : undefined

  return (
    <main className="group/frame relative isolate flex h-dvh flex-col overflow-hidden px-[5vw] py-[5vh]">
      <Backdrop />
      {area.kind === 'recap' && recap ? (
        <RecapScene doc={recap} partyName={session.name} startAt={recapSlide} />
      ) : (
        <>
          <Header line={line} name={session.name} now={now} teams={teamGame !== null} />
          {/* Clipped at its edges, so a scene that runs out of room never paints over the band. */}
          <section data-frame="stage" data-fit="stage" className="mt-7 mb-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden short:mt-5 short:mb-4">
            {area.kind === 'stage' ? (
              <StageView game={area.game} finished={area.finished} />
            ) : ranked.length === 0 ? (
              <Lobby joinCode={session.join_code} open={open} over={over} />
            ) : (
              <Board rows={ranked} gains={gains} strip={strip} invite={join === 'board' ? session.join_code : null} />
            )}
          </section>
          <Band
            games={over ? [] : running}
            joinCode={join === 'code' ? session.join_code : null}
            ticker={ticker}
            sourceOf={titleOf}
            teams={teamGame && !over ? teamPoints(snapshot, teamGame.id) : null}
          />
        </>
      )}
      <TitleCard game={titleCard} />
      <Banner item={banner} source={titleOf(banner?.game_id)} hunt={accentOf(gameTypeOf(banner?.game_id)) === 'hunt'} />
      <Corner live={connected && pings === 'ok'} hostPreview={hostPreview} />
    </main>
  )
}
