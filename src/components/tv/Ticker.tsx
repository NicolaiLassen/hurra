import { onAirText } from '@/components/tv/news'
import { BandEvent, BandLine, Stripes, Tab } from '@/components/tv/onAir'
import type { FeedItem } from '@/lib/types'

/**
 * The ticker: news from a game running in the background while another holds
 * the stage, without sound (news.ts), as an event line in the band (Band):
 * the game's title on a paper tab (the hunt's pink with its stripes, `hunt`),
 * then the time and what happened. It shows for as long as useNews holds it
 * and changes only when something happens; nothing crawls.
 */
export default function Ticker({ item, source, hunt = false }: { item: FeedItem; source?: string; hunt?: boolean }) {
  return (
    <BandLine
      tab={
        hunt ? (
          <>
            <Stripes />
            <Tab tone="pink">{source ?? 'News'}</Tab>
          </>
        ) : (
          <Tab tone="paper">{source ?? 'News'}</Tab>
        )
      }
    >
      <BandEvent at={item.created_at}>{onAirText(item.message)}</BandEvent>
    </BandLine>
  )
}
