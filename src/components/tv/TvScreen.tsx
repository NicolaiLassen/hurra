import { useMemo } from 'react'
import Backdrop from '@/components/tv/Backdrop'
import Band from '@/components/tv/Band'
import Banner from '@/components/tv/Banner'
import Board from '@/components/tv/Board'
import Corner from '@/components/tv/Corner'
import Header from '@/components/tv/Header'
import { JoinBlock } from '@/components/tv/Join'
import Lobby from '@/components/tv/Lobby'
import type { NewsStage } from '@/components/tv/news'
import RecapScene from '@/components/tv/RecapScene'
import { byOldestStart, joinPlace, mainArea, sceneLine } from '@/components/tv/scene'
import StageView from '@/components/tv/StageView'
import Strip from '@/components/tv/Strip'
import TitleCard from '@/components/tv/TitleCard'
import { useEffectsVolume } from '@/components/tv/useEffectsVolume'
import { useGains } from '@/components/tv/useGains'
import { useNews } from '@/components/tv/useNews'
import { useTitleCard } from '@/components/tv/useTitleCard'
import { getGameModule } from '@/games/registry'
import { withRanks } from '@/lib/format'
import { usePublishedRecap } from '@/lib/queries'
import type { RecapDoc } from '@/lib/recap'
import { backgroundGames, recentlyFinished, tvScene, type TvScene } from '@/lib/stage'
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

  const newsStage: NewsStage =
    area.kind === 'recap'
      ? { kind: 'recap' }
      : area.kind === 'stage'
        ? { kind: 'stage', gameId: area.game.id, banners: stageBannersOf(area.game.game_type) }
        : { kind: 'board' }
  const { banner, ticker } = useNews(snapshot.feed, newsStage)
  const titleCard = useTitleCard(shown, session, now)
  const titleOf = (gameId: string | null | undefined) => snapshot.games.find((g) => g.id === gameId)?.title

  // The band has the games in the background. Beside the podium: a bigger
  // party's join block, the game on the stage without a screen of its own, and
  // the games that finished lately.
  const nowPlaying = area.kind === 'board' ? area.nowPlaying : null
  const chips = !over && (nowPlaying !== null || finished.length > 0)
  const strip =
    join === 'qr' || chips
      ? (room: number, chipsHeight?: number) => (
          <div className="flex min-w-0 flex-col items-end gap-6 short:gap-4" style={{ maxWidth: room }}>
            {join === 'qr' && <JoinBlock code={session.join_code} />}
            {chips && <Strip room={room} chipsHeight={chipsHeight} nowPlaying={nowPlaying} running={[]} finished={finished} players={players} />}
          </div>
        )
      : undefined

  return (
    <main className="relative isolate flex h-dvh flex-col overflow-hidden px-[5vw] py-[5vh]">
      <Backdrop />
      {area.kind === 'recap' && recap ? (
        <RecapScene doc={recap} partyName={session.name} startAt={recapSlide} />
      ) : (
        <>
          <Header line={sceneLine(shown, players, snapshot.games)} name={session.name} now={now} />
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
          />
        </>
      )}
      <TitleCard game={titleCard} />
      <Banner item={banner} source={titleOf(banner?.game_id)} />
      <Corner live={connected && pings === 'ok'} hostPreview={hostPreview} />
    </main>
  )
}
