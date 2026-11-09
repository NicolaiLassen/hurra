import { CaretRightIcon, QuestionIcon } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useServerTime } from '@/games/quiz/clock'
import { formatNumber, type QuizGame } from '@/games/quiz/logic'
import { letterOf } from '@/games/quiz/look'
import { SecondsLeft } from '@/games/quiz/parts'
import { choiceIndex, readPublic, readView } from '@/games/quiz/read'
import type { PlayerCardProps } from '@/games/types'

/**
 * The quiz while another game holds the phone's main card: what is happening
 * in one line, and an Answer now button while a question is open. A whole
 * card, title and Live badge included; tapping the header opens the full view.
 */
export default function PlayerCard({ game, publicState, view: rawView, myAnswers, prompts, serverNow, open }: PlayerCardProps<QuizGame>) {
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
    status = last.points > 0 ? `Right! +${formatNumber(last.points)}` : `Not this time. It was ${letterOf(last.correct)}.`
  } else if (pub.phase === 'done') status = 'The quiz is over'
  else status = view?.rank ? `You're #${view.rank} with ${formatNumber(view.quizPoints)}` : 'Waiting for the next question'

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-4">
        <button
          type="button"
          onClick={open}
          className="-m-2 flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="sr-only">Open</span>
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <QuestionIcon weight="duotone" className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-lg leading-tight font-bold">{game.title}</span>
              <Badge className="shrink-0">Live</Badge>
            </span>
            <span className="block truncate text-sm text-muted-foreground">{status}</span>
          </span>
          <CaretRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </button>
        {answerable && question && (
          <Button size="xl" className="w-full" onClick={open}>
            Answer now
            <SecondsLeft endsAt={question.endsAt} serverNow={serverNow} suffix=" s" className="text-primary-foreground" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
