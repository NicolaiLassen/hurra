import { Badge } from '@/components/ui/badge'
import type { GameStatus, Session } from '@/lib/types'

/** A game's status, whether a session takes new players, or that either is archived. */
export type Status = GameStatus | Session['status'] | 'archived'

const LABEL: Record<Status, string> = {
  pending: 'Not started',
  active: 'Live',
  finished: 'Finished',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
}

const VARIANT: Record<Status, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  open: 'default',
  pending: 'outline',
  finished: 'secondary',
  closed: 'secondary',
  archived: 'outline',
}

/** The one way statuses are shown, with the same words on every screen. */
export default function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge variant={VARIANT[status]} className={className}>
      {LABEL[status]}
    </Badge>
  )
}
