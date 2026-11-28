import { ordinal } from '@/components/phone/text'
import type { SoundtrackGame } from '@/games/soundtrack/logic'
import { Answering } from '@/games/soundtrack/phone/Answering'
import { Lobby, SitOut } from '@/games/soundtrack/phone/Lobby'
import { Reveal } from '@/games/soundtrack/phone/Reveal'
import { readPublic, readView } from '@/games/soundtrack/read'
import type { PlayerViewProps } from '@/games/types'

// Lydspor on a guest's phone (.design/lydspor/spec.md, section 4). The phone
// draws the strap above it ("Song 5 of 8", phoneStrap in index.ts). The
// lobby's rules; then, while songs play, Now playing and Your board, where
// the guest types each song's title and singer and taps its photo, all
// changeable until the last call; the lock; and each reveal with how it went.
// Typed answers are judged on the server at the lock, never here.

export default function PlayerView({
  game,
  publicState,
  view: rawView,
  myAnswers,
  onStage,
  submit,
  serverNow,
  mediaUrl,
  player,
  players,
}: PlayerViewProps<SoundtrackGame>) {
  const pub = readPublic(publicState)
  const view = readView(rawView)
  if (!pub) return <p className="py-8 text-center text-paper-2">Getting Lydspor ready…</p>
  if (view?.sittingOut) return <SitOut />

  switch (pub.phase) {
    case 'lobby':
      return <Lobby pub={pub} onStage={onStage} mediaUrl={mediaUrl} />
    case 'playing':
    case 'lastCall':
    case 'locked':
      return (
        <Answering
          // A new round starts afresh.
          key={`${game.id}:${game.started_at ?? ''}`}
          game={game}
          pub={pub}
          locked={view?.mine ?? null}
          myAnswers={myAnswers}
          submit={submit}
          serverNow={serverNow}
          mediaUrl={mediaUrl}
          onStage={onStage}
        />
      )
    case 'reveal':
    case 'standings':
      return <Reveal pub={pub} view={view} mediaUrl={mediaUrl} onStage={onStage} player={player} players={players} />
    case 'done':
      return (
        <div className="grid gap-1.5">
          <p className="text-[24px] leading-[1.12] font-extrabold">Lydspor is over.</p>
          {view?.final && (
            <p className="text-base text-paper-2">
              You placed {ordinal(view.final.place)} with {view.final.points} Lydspor {view.final.points === 1 ? 'point' : 'points'}.
            </p>
          )}
        </div>
      )
  }
}
