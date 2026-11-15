import { CrownIcon, GameControllerIcon, RankingIcon, TrophyIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import Backdrop from '@/components/tv/Backdrop'
import Banner from '@/components/tv/Banner'
import Board, { EmptyBoard } from '@/components/tv/Board'
import Corner from '@/components/tv/Corner'
import Header from '@/components/tv/Header'
import type { NewsStage } from '@/components/tv/news'
import Rail from '@/components/tv/Rail'
import RecapScene from '@/components/tv/RecapScene'
import { byOldestStart, joinCardPlace, mainArea, sceneLine } from '@/components/tv/scene'
import StageView from '@/components/tv/StageView'
import Strip from '@/components/tv/Strip'
import Ticker from '@/components/tv/Ticker'
import TitleCard from '@/components/tv/TitleCard'
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
 * The TV once paired (docs/engine-v2.md, 7.2): the scene from stage.ts decides
 * what fills the screen. A game's own screen takes the stage with the rail
 * beside it (the day's top 5, the games in the background, the ones that
 * finished lately); between games the podium and standings, with the status
 * cards in a strip beside the podium; the recap full screen. Announcements
 * become the banner, a sound, or the ticker (news.ts). Reads the nearest
 * LiveSessionProvider, whose snapshot must be a member's.
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
  const joinCard = joinCardPlace(area, open, ranked.length)

  // The game on the stage, and what runs beside it.
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

  const nowPlaying = area.kind === 'board' ? area.nowPlaying : null
  const strip =
    !over && (nowPlaying || running.length > 0 || finished.length > 0)
      ? (room: number, chipsOnly: boolean) => (
          <Strip room={room} chipsOnly={chipsOnly} nowPlaying={nowPlaying} running={running} finished={finished} players={players} />
        )
      : undefined

  return (
    // The bottom gutter keeps the corner controls (and the ticker) clear of the board.
    <main className="relative isolate flex h-dvh flex-col gap-8 overflow-hidden p-10 pb-16 short:gap-6 short:p-8 short:pb-16">
      <Backdrop />
      {area.kind === 'recap' && recap ? (
        <RecapScene doc={recap} partyName={session.name} startAt={recapSlide} />
      ) : (
        <>
          <Header
            name={session.name}
            line={sceneLine(shown, players)}
            icon={<SceneIcon scene={shown} />}
            joinCode={joinCard === 'header' ? session.join_code : null}
          />
          {area.kind === 'stage' ? (
            <div className="flex min-h-0 flex-1 gap-8 short:gap-6">
              <section data-fit="stage" className="flex min-h-0 min-w-0 flex-1 flex-col">
                <StageView game={area.game} finished={area.finished} />
              </section>
              <Rail top={ranked.slice(0, 5)} gains={gains} running={running} finished={finished} players={players} />
            </div>
          ) : ranked.length === 0 ? (
            <EmptyBoard joinCode={session.join_code} open={open} over={over} />
          ) : (
            <Board rows={ranked} gains={gains} strip={strip} invite={joinCard === 'board' ? session.join_code : null} />
          )}
        </>
      )}
      {area.kind === 'stage' && <Ticker item={ticker} source={titleOf(ticker?.game_id)} />}
      <TitleCard game={titleCard} />
      <Banner item={banner} eyebrow={titleOf(banner?.game_id)} />
      <Corner live={connected && pings === 'ok'} hostPreview={hostPreview} />
    </main>
  )
}

/** The icon before the header's scene line. */
function SceneIcon({ scene }: { scene: TvScene }) {
  switch (scene.kind) {
    case 'live': {
      const Icon = getGameModule(scene.game.game_type)?.icon ?? GameControllerIcon
      return <Icon weight="duotone" className="text-confetti-teal" />
    }
    case 'final':
    case 'over':
    case 'recap':
      return <TrophyIcon weight="fill" className="text-primary" />
    case 'standings':
      return scene.lastGame ? <CrownIcon weight="fill" className="text-primary" /> : <RankingIcon weight="duotone" className="text-primary" />
  }
}
