import { CaretRightIcon } from '@phosphor-icons/react'
import { useId } from 'react'
import { ordinal } from '@/components/phone/text'
import { SectionHead } from '@/components/phone/Strap'
import { Button } from '@/components/ui/button'
import { useServerTime } from '@/games/quiz/clock'
import { formatNumber, type QuizGame } from '@/games/quiz/logic'
import { letterOf } from '@/games/quiz/look'
import { TimeLeft } from '@/games/quiz/phoneParts'
import { choiceIndex, readPublic, readView } from '@/games/quiz/read'
import type { PlayerCardProps } from '@/games/types'

/**
 * The quiz's section on the phone home while another game holds the main
 * card: its tab (gold while the TV shows it), what is happening in one line
 * on a row that opens the full view, and an outlined Answer now while a
 * question is open. Show my code stays the home's one gold step.
 */
export default function PlayerCard({ game, publicState, view: rawView, myAnswers, prompts, serverNow, onStage, open }: PlayerCardProps<QuizGame>) {
  const id = useId()
  const pub = readPublic(publicState)
  const view = readView(rawView)
  const question = pub?.phase === 'question' ? pub.question : null
  const mine = question ? choiceIndex(myAnswers[question.key]) : null
  const now = useServerTime(serverNow, 1000, question !== null && mine === null)
  const closed = question ? (prompts.find((p) => p.key === question.key)?.closed_at ?? null) !== null : true
  const answerable = question !== null && mine === null && !closed && now < question.endsAt
  const last = view?.last && pub && view.last.index === pub.index ? view.last : null

  let status: string
  if (!pub) status = 'Getting the quiz ready…'
  else if (pub.phase === 'lobby') status = 'Starting soon'
  else if (pub.phase === 'question') {
    status = mine !== null ? `Locked in: ${letterOf(mine)}` : answerable ? `Question ${pub.index + 1} of ${pub.total} is open` : "Time's up"
  } else if (pub.phase === 'reveal' && last) {
    status = last.points > 0 ? `You got it, +${formatNumber(last.points)}` : `Not this time. It was ${letterOf(last.correct)}.`
  } else if (pub.phase === 'done') status = 'The quiz is over'
  else status = view?.rank ? `You're ${ordinal(view.rank)}, with ${formatNumber(view.quizPoints)}` : 'Waiting for the next question'

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
      {answerable && question && (
        <Button size="xl" variant="outline" className="w-full justify-between" onClick={open}>
          Answer now
          <TimeLeft endsAt={question.endsAt} serverNow={serverNow} />
        </Button>
      )}
    </section>
  )
}
