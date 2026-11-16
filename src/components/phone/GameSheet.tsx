import { XIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Strap, type TabTone } from '@/components/phone/Strap'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'

/**
 * A game opened from the phone home, full screen (docs/engine-v2.md, 7.1): a
 * background game's whole PlayerView, or a finished game's result. Its header
 * holds the game's strap (its name, gold while the TV shows it, and where it
 * stands) and a close button; the game scrolls under it.
 *
 * Nothing in the sheet's frame may set a transform, filter or backdrop filter:
 * games draw full-screen layers of their own inside it (the scan sheet, the
 * fusion picker), which must stay fixed to the screen.
 */
export default function GameSheet({
  open,
  onClose,
  tone,
  title,
  line,
  children,
}: {
  open: boolean
  onClose: () => void
  tone: TabTone
  title: string
  line: string | null
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 bg-ground p-0 data-[side=bottom]:h-dvh data-[side=bottom]:border-t-0"
      >
        <header className="bg-raised px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
          <div className="mx-auto w-full max-w-md">
            <Strap
              title={title}
              tone={tone}
              line={line}
              heading={SheetTitle}
              aside={
                <SheetClose asChild>
                  <Button variant="ghost" size="icon-lg" className="-mr-2" aria-label="Close">
                    <XIcon className="size-5" />
                  </Button>
                </SheetClose>
              }
            />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto grid w-full max-w-md grid-cols-1 px-4 pt-6 pb-[max(env(safe-area-inset-bottom),2rem)]">
            {children}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
