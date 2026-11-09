import { XIcon, type Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { GameEyebrow, GameIcon, type GameStatus } from '@/components/phone/GameCard'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * A game opened from the phone home, full screen (docs/engine-v2.md, 7.1): a
 * background game's whole PlayerView, or a finished game's result. Its header
 * holds the eyebrow, the title and a close button; the game scrolls under it.
 *
 * Nothing in the sheet's frame may set a transform, filter or backdrop filter:
 * games draw full-screen layers of their own inside it (the scan sheet, the
 * fusion picker), which must stay fixed to the screen.
 */
export default function GameSheet({
  open,
  onClose,
  status,
  icon,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  status: GameStatus
  icon: Icon
  title: string
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 bg-background p-0 data-[side=bottom]:h-dvh data-[side=bottom]:border-t-0"
      >
        <header className="border-b px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
          <div className="mx-auto flex w-full max-w-md items-center gap-3">
            <GameIcon icon={icon} />
            <div className="min-w-0 flex-1">
              <GameEyebrow status={status} />
              <SheetTitle className="truncate text-xl leading-tight font-bold">{title}</SheetTitle>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon-lg" className="-mr-2 shrink-0" aria-label="Close">
                <XIcon className="size-5" />
              </Button>
            </SheetClose>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto grid w-full max-w-md grid-cols-1 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),2rem)]">
            {children}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
