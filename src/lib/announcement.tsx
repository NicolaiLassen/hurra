import {
  ConfettiIcon,
  CrownIcon,
  DetectiveIcon,
  LightningIcon,
  MegaphoneIcon,
  SkullIcon,
  StarIcon,
  SwordIcon,
  TargetIcon,
  TrophyIcon,
  type Icon,
} from '@phosphor-icons/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import type { AnnouncementIcon, Tone } from '@/games/core/Game'
import { CALLOUT_TONE } from '@/lib/callout'
import type { FeedItem } from '@/lib/types'
import { toast } from '@/lib/toast'

// How the app renders announcements (the event channel from games): the same
// icons, tones and callout for every game, as a toast on phones and as the
// banner on the TV.

/** What the app shows of an announcement; `detail` is the second line (null on older rows). */
export type Announcement = Pick<FeedItem, 'message' | 'icon' | 'tone' | 'detail'>

const iconByName: Record<AnnouncementIcon, Icon> = {
  megaphone: MegaphoneIcon,
  sword: SwordIcon,
  detective: DetectiveIcon,
  skull: SkullIcon,
  crown: CrownIcon,
  confetti: ConfettiIcon,
  trophy: TrophyIcon,
  star: StarIcon,
  lightning: LightningIcon,
  target: TargetIcon,
}

export const announcementIcon = (name: string | null | undefined): Icon =>
  (name && iconByName[name as AnnouncementIcon]) || MegaphoneIcon

export const announcementTone = (tone: string | null | undefined): Tone =>
  tone && tone in CALLOUT_TONE ? (tone as Tone) : 'gold'

/** Shows an announcement as a toast: the shared callout in its tone, with its detail as the second line. */
export function toastAnnouncement(item: Announcement) {
  toast(item.message, {
    icon: <AnnouncementIconView name={item.icon} />,
    tone: announcementTone(item.tone),
    description: item.detail ?? undefined,
  })
}
