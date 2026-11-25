import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ReviewRow, TypedPart } from '../types'
import { acceptId, guests, reasonTag, type PartReview, type SongReview } from './review'

/** Close rows shown per part before "3 more close answers". */
const FIRST_ROWS = 8

export type AcceptProps = {
  /** False once Lydspor is crowned: the panel is read-only. */
  open: boolean
  /** The id of the step in flight, if any: its button shows it, the others wait. */
  pending: string | null
  onAccept: (part: TypedPart, row: ReviewRow, accepted: boolean) => void
}

/**
 * The close answers at a reveal (spec 10.1, mockup 06): for the title and the
 * singer, the truth, how many got it (with the host's accepts) and each
 * close answer with how many typed it and why it is close, one tap to accept
 * it for all of them. The other answers, which the host may still accept,
 * and what the rule counted already sit in two folds under them. Never gold:
 * gold is the next step's.
 */
export default function ReviewPanel({
  review,
  latest,
  onShowLatest,
  ...accept
}: AcceptProps & {
  review: SongReview
  /** The latest revealed song, when the panel shows an older one. */
  latest: number | null
  onShowLatest: () => void
}) {
  const others = review.title.wrong.length + review.singer.wrong.length
  const counted = review.title.typo.length + review.singer.typo.length

  return (
    <section className="grid grid-cols-1 gap-4 rounded-lg bg-overlay p-4" aria-labelledby={`review-${review.n}`}>
      <div className="grid grid-cols-1 gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id={`review-${review.n}`} className="text-lg font-extrabold">
            Close answers, song {review.n}
          </h3>
          {latest !== null && (
            <Button type="button" variant="link" size="sm" className="px-0" onClick={onShowLatest}>
              Back to song {latest}
            </Button>
          )}
        </div>
        <p className="text-paper-2">
          {accept.open ? 'Accept one and everyone who typed it gets the point.' : 'Lydspor is over. Accepts are closed.'}
        </p>
      </div>

      <Part review={review} part={review.title} {...accept} />
      <Part review={review} part={review.singer} {...accept} />

      {(others > 0 || counted > 0) && (
        <div className="grid grid-cols-1 gap-1 border-t border-rule pt-2">
          {others > 0 && (
            <Fold label="Other answers" count={`(${others})`}>
              <p className="text-sm text-paper-2">Wrong by the rule. Accept one if it should count: a cover's singer, a nickname.</p>
              <FoldPart review={review} part={review.title} rows={review.title.wrong} {...accept} />
              <FoldPart review={review} part={review.singer} rows={review.singer.wrong} {...accept} />
            </Fold>
          )}
          {counted > 0 && (
            <Fold label="Counted already" count={`(${counted} ${counted === 1 ? 'spelling' : 'spellings'})`}>
              <p className="text-sm text-paper-2">The rule forgave these spellings. They count, and stay counted.</p>
              <FoldPart review={review} part={review.title} rows={review.title.typo} {...accept} readOnly />
              <FoldPart review={review} part={review.singer} rows={review.singer.typo} {...accept} readOnly />
            </Fold>
          )}
        </div>
      )}
    </section>
  )
}

/** One part's head and its close answers. */
function Part({ review, part, ...accept }: AcceptProps & { review: SongReview; part: PartReview }) {
  const [all, setAll] = useState(false)
  const shown = all ? part.close : part.close.slice(0, FIRST_ROWS)
  const hidden = part.close.length - shown.length
  return (
    <div className="grid grid-cols-1 gap-2">
      <PartHead review={review} part={part} />
      {part.close.length === 0 ? (
        <p className="text-sm text-paper-2">No close answers for the {part.part}.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {shown.map((row) => (
            <Row key={row.key} index={review.index} part={part.part} row={row} {...accept} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setAll(true)}>
          {hidden} more close {hidden === 1 ? 'answer' : 'answers'}
        </Button>
      )}
    </div>
  )
}

/** "TITLE Paper Lanterns ... 18 of 22 got it": the count changes in place when the host accepts. */
function PartHead({ review, part }: { review: SongReview; part: PartReview }) {
  return (
    <div className="flex items-baseline gap-x-3">
      <p className="min-w-0 flex-1">
        <span className="on-air mr-2 text-[13px] text-paper-2">{part.part}</span>
        <span className="text-[17px] font-extrabold break-words">{part.truth}</span>
      </p>
      <p className="shrink-0 text-sm text-paper-2">
        <span className="tv-num text-xl text-paper">
          {part.got} of {review.of}
        </span>{' '}
        got it
      </p>
    </div>
  )
}

function Row({
  index,
  part,
  row,
  open,
  pending,
  onAccept,
  readOnly = false,
}: AcceptProps & { index: number; part: TypedPart; row: ReviewRow; readOnly?: boolean }) {
  const id = acceptId(index, part, row.key)
  const busy = pending !== null
  return (
    <li className="flex items-center gap-3 rounded-lg bg-raised py-2.5 pr-2.5 pl-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] leading-snug font-bold break-words">“{row.text}”</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-paper-2">
          <span>{guests(row.players.length)}</span>
          {readOnly ? (
            <Badge variant="secondary" className="h-6 px-1.5 text-[13px]">Spelling forgiven</Badge>
          ) : (
            row.verdict === 'close' && (
              <Badge variant="secondary" className="h-6 px-1.5 text-[13px]">
                {reasonTag(row, part)}
              </Badge>
            )
          )}
        </p>
      </div>
      {!readOnly &&
        (row.accepted ? (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {/* A step lighter with the word and a check: never gold, which is the next step's. */}
            <span className="flex h-8 items-center gap-1.5 rounded-chip bg-paper px-2.5 text-sm font-bold text-ink">
              <CheckIcon weight="bold" className="size-4" />
              Accepted
            </span>
            {open && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-7 px-0"
                disabled={busy}
                isPending={pending === id}
                aria-label={`Undo accepting “${row.text}”`}
                onClick={() => onAccept(part, row, false)}
              >
                Undo
              </Button>
            )}
          </div>
        ) : (
          open && (
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 px-4 text-base"
              disabled={busy}
              isPending={pending === id}
              aria-label={`Accept “${row.text}” for the ${part}`}
              onClick={() => onAccept(part, row, true)}
            >
              Accept
            </Button>
          )
        ))}
    </li>
  )
}

function Fold({ label, count, children }: { label: string; count: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="grid grid-cols-1 gap-2">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 rounded-control text-left text-base font-bold hover:text-paper focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretRightIcon className={cn('size-4 shrink-0 text-paper-2 transition-transform', open && 'rotate-90')} />
        {label}
        <span className="font-medium text-paper-2">{count}</span>
      </button>
      {open && <div className="grid grid-cols-1 gap-3 pb-2">{children}</div>}
    </div>
  )
}

/** One part's rows inside a fold, under a small head, or nothing when it has none. */
function FoldPart({
  review,
  part,
  rows,
  readOnly = false,
  ...accept
}: AcceptProps & { review: SongReview; part: PartReview; rows: ReviewRow[]; readOnly?: boolean }) {
  if (rows.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-2">
      <p>
        <span className="on-air mr-2 text-[13px] text-paper-2">{part.part}</span>
        <span className="font-bold">{part.truth}</span>
      </p>
      <ul className="grid grid-cols-1 gap-2">
        {rows.map((row) => (
          <Row key={row.key} index={review.index} part={part.part} row={row} readOnly={readOnly} {...accept} />
        ))}
      </ul>
    </div>
  )
}
