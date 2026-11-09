import type { ReactNode } from 'react'
import Logo from '@/components/Logo'
import Qr from '@/components/Qr'
import type { SceneLine } from '@/components/tv/scene'
import { joinUrl } from '@/lib/urls'

/**
 * The TV's header: the logo, the party's name and a line saying what is on
 * ("Now on stage: Quiz", "Last game: Mads won Quiz"), with the join card while
 * joining is open.
 */
export default function Header({
  name,
  line,
  icon,
  joinCode,
}: {
  name: string
  line: SceneLine
  icon: ReactNode
  /** The join card's code, or null to leave it out (joining closed, nobody here yet). */
  joinCode: string | null
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-8">
      <div className="flex min-w-0 items-center gap-5">
        <Logo className="size-16 shrink-0 lg:size-20 short:size-14" />
        <div className="min-w-0">
          <h1 className="truncate text-4xl font-black tracking-tight lg:text-6xl short:text-4xl">{name}</h1>
          <p className="mt-2 flex min-w-0 items-center gap-3 text-xl text-muted-foreground lg:text-2xl short:mt-1 short:text-xl">
            <span className="flex shrink-0 [&>svg]:size-6 short:[&>svg]:size-5">{icon}</span>
            <span className="min-w-0 truncate">
              {line.lead}
              {line.strong && <span className="font-semibold text-foreground"> {line.strong}</span>}
            </span>
          </p>
        </div>
      </div>
      {joinCode && <JoinCard joinCode={joinCode} />}
    </header>
  )
}

function JoinCard({ joinCode }: { joinCode: string }) {
  return (
    // A smaller code on short screens leaves the rail room for one more card.
    <div className="flex shrink-0 items-center gap-4 rounded-3xl bg-card/80 p-3 pr-6 ring-1 ring-foreground/10 backdrop-blur short:[&_svg]:size-22">
      <Qr value={joinUrl(joinCode)} size={104} />
      <div>
        <p className="text-lg text-muted-foreground short:text-base">Join the game</p>
        <p className="font-mono text-3xl font-black tracking-widest text-primary short:text-2xl">{joinCode}</p>
      </div>
    </div>
  )
}
