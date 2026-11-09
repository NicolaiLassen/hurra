import { FlagCheckeredIcon, TelevisionSimpleIcon, type Icon } from '@phosphor-icons/react'
import { createElement, type ReactNode, type Ref } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Where a game is, as the eyebrow over its title says it. */
export type GameStatus = 'stage' | 'playing' | 'running' | 'finished'

/** A small uppercase label over a title, or a section's heading (`as="h2"`). */
export function Eyebrow({
  as: Tag = 'p',
  id,
  className,
  children,
}: {
  as?: 'p' | 'h2' | 'h3'
  id?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Tag
      id={id}
      className={cn('flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase', className)}
    >
      {children}
    </Tag>
  )
}

/** A teal dot that breathes: this is happening now. */
function LiveDot() {
  return (
    <span aria-hidden className="relative grid size-2 place-items-center">
      <span className="absolute size-2 animate-ping rounded-full bg-confetti-teal/60 motion-reduce:animate-none" />
      <span className="size-2 rounded-full bg-confetti-teal" />
    </span>
  )
}

/** "On the TV", "Now playing", "Also running" or "Finished". */
export function GameEyebrow({ status }: { status: GameStatus }) {
  switch (status) {
    case 'stage':
      return (
        <Eyebrow className="text-primary">
          <TelevisionSimpleIcon weight="fill" className="size-3.5" />
          On the TV
        </Eyebrow>
      )
    case 'playing':
    case 'running':
      return (
        <Eyebrow className="text-confetti-teal">
          <LiveDot />
          {status === 'playing' ? 'Now playing' : 'Also running'}
        </Eyebrow>
      )
    case 'finished':
      return (
        <Eyebrow>
          <FlagCheckeredIcon weight="fill" className="size-3.5" />
          Finished
        </Eyebrow>
      )
  }
}

/** The game's icon in a gold tile. */
export function GameIcon({ icon, className }: { icon: Icon; className?: string }) {
  return (
    <span className={cn('grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary', className)}>
      {createElement(icon, { weight: 'duotone', className: 'size-6' })}
    </span>
  )
}

/**
 * The phone's card around a game (docs/engine-v2.md, 7.1): the eyebrow, the
 * game's icon and title, then the game's own content. Games draw only what
 * goes inside.
 */
export default function GameCard({
  status,
  icon,
  title,
  ref,
  children,
}: {
  status: GameStatus
  icon: Icon
  title: string
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <Card ref={ref} className="scroll-mt-4 gap-5">
      <CardHeader className="flex items-center gap-3">
        <GameIcon icon={icon} />
        <div className="min-w-0">
          <GameEyebrow status={status} />
          <CardTitle role="heading" aria-level={2} className="truncate text-xl leading-tight font-bold">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      {/* grid-cols-1: the column may shrink, so a game's long words wrap instead of widening the card. */}
      <CardContent className="grid grid-cols-1 gap-4">{children}</CardContent>
    </Card>
  )
}
