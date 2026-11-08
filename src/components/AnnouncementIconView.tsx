import { createElement } from 'react'
import { announcementIcon } from '@/lib/announcement'

/** An announcement's icon by name (falls back to the megaphone). */
export default function AnnouncementIconView({ name, className }: { name: string | null | undefined; className?: string }) {
  return createElement(announcementIcon(name), { weight: 'fill', className })
}
