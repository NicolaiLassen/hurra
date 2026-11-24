import { useId, type ReactNode, type Ref } from 'react'
import { Strap, type TabTone } from '@/components/phone/Strap'

/**
 * The game on the phone's main card (docs/engine-v2.md, 7.1), standing on the
 * ground like a programme: the strap with the game's name (gold while the TV
 * shows it) and where it stands, this phone's own token at the right, then the
 * game's own content. Games draw only what goes inside.
 */
export default function GameCard({
  title,
  tone,
  line,
  aside,
  ref,
  children,
}: {
  title: string
  tone: TabTone
  /** The strap's words: "Question 3 of 10", "On the TV", "Finished at 22:41". */
  line: string | null
  /** This phone's own token. */
  aside?: ReactNode
  ref?: Ref<HTMLElement>
  children: ReactNode
}) {
  const id = useId()
  return (
    <section ref={ref} aria-labelledby={id} className="grid scroll-mt-4 grid-cols-1 gap-6">
      <Strap title={title} tone={tone} line={line} aside={aside} headingId={id} />
      {/* grid-cols-1: the column may shrink, so a game's long words wrap instead of widening the page. */}
      <div className="grid grid-cols-1 gap-4">{children}</div>
    </section>
  )
}
