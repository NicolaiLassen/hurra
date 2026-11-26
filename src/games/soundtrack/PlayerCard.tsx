import { CaretRightIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import { ordinal } from '@/components/phone/text'
import { SectionHead } from '@/components/phone/Strap'
import { Button } from '@/components/ui/button'
import { pointsPerSong, type SoundtrackGame } from '@/games/soundtrack/logic'
import { useNow } from '@/games/soundtrack/phone/hooks'
import { songsWord } from '@/games/soundtrack/phone/words'
import { answerPhoto, answerText, readPublic, readView } from '@/games/soundtrack/read'
import { promptKey } from '@/games/soundtrack/types'
import type { PlayerCardProps } from '@/games/types'

/**
 * Lydspor's section on the phone home while another game holds the main
 * card: its tab (gold while the TV shows it), where it stands in one line on
 * a row that opens the full view, and an outlined button while there is a
 * song to name or a last call to answer. Show my code stays the home's one
 * gold step.
 */
export default function PlayerCard({ game, publicState, view: rawView, myAnswers, serverNow, onStage, open }: PlayerCardProps<SoundtrackGame>) {
  const id = useId()
  const pub = readPublic(publicState)
  const view = readView(rawView)
  const lastCall = pub?.phase === 'lastCall' && pub.lockAt !== null ? pub.lockAt : null
  const now = useNow(serverNow, 1000, lastCall !== null)
  const played = pub?.playedAt.length ?? 0
  const named =
    played > 0 &&
    answerText(myAnswers[promptKey(played, 'title')]) !== null &&
    answerText(myAnswers[promptKey(played, 'singer')]) !== null &&
    answerPhoto(myAnswers[promptKey(played, 'event')]) !== null
  const secondsLeft = lastCall !== null ? Math.max(0, Math.ceil((lastCall - now) / 1000)) : null

  let status: string
  let action: string | null = null
  if (!pub) status = 'Getting Lydspor ready…'
  else if (view?.sittingOut) status = 'You sit this one out'
  else if (pub.phase === 'lobby') status = `${songsWord(pub.total)}, starting soon`
  else if (pub.phase === 'playing') {
    status = named ? `Song ${played} is named` : `Song ${played} of ${pub.total} is playing`
    if (!named) action = `Name song ${played}`
  } else if (pub.phase === 'lastCall' && secondsLeft !== null && secondsLeft > 0) {
    status = `Last call: ${secondsLeft} s left`
    action = 'Check your board'
  } else if (pub.phase === 'lastCall' || pub.phase === 'locked') status = 'Your answers are locked'
  else if ((pub.phase === 'reveal' || pub.phase === 'standings') && pub.reveal) {
    const song = view?.songs[pub.reveal.n - 1]
    status = view?.rank
      ? `You’re ${ordinal(view.rank)}, with ${view.points} Lydspor ${view.points === 1 ? 'point' : 'points'}`
      : `Song ${pub.reveal.n}: ${song?.points ?? 0} of ${pointsPerSong(pub.points)} points`
  } else status = 'Lydspor is over'

  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-3">
      <SectionHead id={id} tab={game.title} tone={onStage ? 'air' : 'plain'} />
      <button
        type="button"
        onClick={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-phone bg-overlay px-4 py-2.5 text-left transition-colors hover:bg-rule focus-visible:ring-3 focus-visible:ring-gold/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate text-[17px] font-bold">{status}</span>
        <span className="sr-only">Open</span>
        <CaretRightIcon className="size-5 shrink-0 text-paper-2" />
      </button>
      {action && (
        <Button size="xl" variant="outline" className="w-full" onClick={open}>
          {action}
        </Button>
      )}
    </section>
  )
}
