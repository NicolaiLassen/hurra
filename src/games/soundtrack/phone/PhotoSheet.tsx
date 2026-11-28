import { ArrowCounterClockwiseIcon, XIcon } from '@phosphor-icons/react'
import { BAR_NOTE_BOTTOM } from '@/components/phone/ShowMyCode'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { Band } from './model'
import type { SwapNotice } from './useAnswers'
import { Wall } from './Wall'

/**
 * The photo sheet (spec 4.6): an earlier song's event, from the board or a
 * one-tap row. "Song 2: which event?", when it started and what the guest
 * typed for it, and the wall with "Here now" and "Swap with n". One tap
 * saves and closes it.
 */
export function PhotoSheet({
  n,
  open,
  onClose,
  reminder,
  note,
  photos,
  bandOf,
  thumbUrl,
  onTap,
  disabled,
  failed,
  ask = 'which event?',
}: {
  n: number
  open: boolean
  onClose: () => void
  /** "Started at 21:01. You have “Seven Ferries” by “Coldwave”." */
  reminder: string
  /** Why the last tap didn't go through. */
  note: string | null
  photos: readonly { path: string; hint: string | null }[]
  bandOf: (index: number) => Band
  thumbUrl: (path: string) => string
  onTap: (index: number) => void
  disabled: boolean
  failed: number | null
  /** The question after "Song n:". The wall with a typed moment asks for the photo, as its Picture field says. */
  ask?: string
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-[18px] bg-raised px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),1.5rem)] data-[side=bottom]:border-t-0"
      >
        <div className="mx-auto grid w-full max-w-md grid-cols-1">
          <div aria-hidden className="mx-auto mb-2.5 h-1 w-10 rounded-sm bg-rule" />
          <div className="flex items-center gap-3">
            <SheetTitle className="min-w-0 flex-1 text-[22px] leading-tight font-extrabold text-paper">Song {n}: {ask}</SheetTitle>
            <SheetClose asChild>
              <Button variant="secondary" size="icon-lg" aria-label="Close" className="size-11 rounded-[12px]">
                <XIcon className="size-5" />
              </Button>
            </SheetClose>
          </div>
          {reminder && <p className="mt-1.5 text-base leading-snug text-paper-2">{reminder}</p>}
          {note && (
            <p role="status" className="mt-1.5 text-base leading-snug font-semibold text-paper">
              {note}
            </p>
          )}
          <div className="mt-3.5">
            <Wall
              photos={photos}
              bandOf={bandOf}
              thumbUrl={thumbUrl}
              onTap={onTap}
              disabled={disabled}
              failed={failed}
              surface="raised"
              label={`Photos for song ${n}`}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The swap toast with Undo (spec 4.7), above the Show my code bar, on Now
 * playing and the board alike: "Song 2 and song 5 swapped events." It lasts
 * until the next change or 8 seconds. It stands on the bar as tall as it is
 * now (BAR_NOTE_BOTTOM), so a task turned over on the bar pushes it up
 * instead of covering it.
 */
export function SwapToast({ notice, onUndo, busy }: { notice: SwapNotice; onUndo: () => void; busy: boolean }) {
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 z-40', BAR_NOTE_BOTTOM)}>
      <div className="mx-auto max-w-md px-4">
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-phone bg-overlay py-2.5 pr-2.5 pl-4 shadow-xl shadow-black/40 duration-200 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
        >
          <p className="min-w-0 flex-1 text-base leading-tight font-bold">
            {notice.title}
            <span className="mt-0.5 block text-sm font-semibold text-paper-2">{notice.detail}</span>
          </p>
          <Button
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={onUndo}
            className="h-11 shrink-0 gap-1.5 rounded-[12px] border-2 border-paper-3 px-3.5 text-base font-extrabold"
          >
            <ArrowCounterClockwiseIcon weight="bold" className="size-[18px]" />
            Undo
          </Button>
        </div>
      </div>
    </div>
  )
}
