import { ArrowLeftIcon } from '@phosphor-icons/react'
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Notice } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { forgetJoinCode } from '@/lib/storage'

/** Where a "not here" screen leads: the start page, another party, or the host's sessions. */
type Back = 'start' | 'party' | 'host'

const BACK: Record<Back, { to: string; label: string }> = {
  start: { to: '/', label: 'Go to the start page' },
  party: { to: '/', label: 'Join another party' },
  host: { to: '/host', label: 'Back to your sessions' },
}

/** The way out of a dead end, as a full-width phone button. */
export function WayBack({ back, variant = 'default' }: { back: Back; variant?: 'default' | 'secondary' }) {
  const { to, label } = BACK[back]
  return (
    <Button asChild size="xl" variant={variant}>
      <Link to={to}>
        {back === 'host' && <ArrowLeftIcon />}
        {label}
      </Link>
    </Button>
  )
}

/**
 * The one "not here" screen: an unknown address, or an id or code that doesn't
 * exist (anymore). `back` picks the way out that fits who's looking.
 */
export default function NotFound({
  title = 'Page not found',
  children = "There's nothing at this address.",
  back = 'start',
}: {
  title?: string
  children?: ReactNode
  back?: Back
}) {
  return (
    <Notice title={title} actions={<WayBack back={back} />}>
      {children}
    </Notice>
  )
}

/** A party code (phone link) that leads nowhere. Forgets it, so the start page stops offering it. */
export function PartyNotFound({ code }: { code: string }) {
  useEffect(() => forgetJoinCode(code), [code])
  return (
    <NotFound title="Party not found" back="party">
      There's no party with the code {code}. It may have been deleted, or the code is wrong.
    </NotFound>
  )
}

/** A session id (host or TV link) that leads nowhere. */
export function SessionNotFound() {
  return (
    <NotFound title="Session not found" back="host">
      It may have been deleted, or the link is wrong.
    </NotFound>
  )
}
