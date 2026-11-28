import { useEffect, type ReactNode } from 'react'
import type { SoundtrackPublicState } from '@/games/soundtrack/types'
import { introLine, payoutLine } from './words'

// Lydspor's lobby on a phone (spec 4.1): whose songs these are, where to look,
// the rules in four lines and what each part is worth. It also loads the
// wall's thumbnails once, so the photos are there when song 1 starts.

const RULES: ReactNode[] = [
  <>
    A song plays. Type its <b>title</b> and <b>who sings it</b>, then tap its <b>event</b> in the photos.
  </>,
  'Close spelling counts. Change any song until the last call.',
  'Each photo fits one song. Some photos fit none.',
]

/** The rules with typed moments on: each song shows its own photo, and the guest types its moment. */
const MOMENT_RULES: ReactNode[] = [
  <>
    A song plays and its photo shows. Type the <b>moment</b>, the song’s <b>title</b> and <b>who sings it</b>.
  </>,
  'Close spelling counts. Change any song until the last call.',
  'Each song has its own photo. The moment is what happened in it.',
]

export function Lobby({
  pub,
  onStage,
  mediaUrl,
}: {
  pub: SoundtrackPublicState
  onStage: boolean
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
}) {
  // The thumbnails, about 30 KB each, load once here rather than as song 1 starts.
  const paths = pub.wall.map((photo) => photo.path).join('\n')
  useEffect(() => {
    if (paths === '') return
    for (const path of paths.split('\n')) {
      const image = new Image()
      image.decoding = 'async'
      image.src = mediaUrl(path, 'thumb')
    }
  }, [paths, mediaUrl])

  const chips = [
    [pub.momentTyped ? 'Moment' : 'Event', pub.points.event],
    ['Title', pub.points.title],
    ['Singer', pub.points.singer],
  ] as const

  return (
    <div className="grid grid-cols-1">
      <p className="text-[24px] leading-[1.12] font-extrabold tracking-[-0.01em] text-balance">{introLine(pub.intro, pub.total, pub.momentTyped)}</p>
      <p className="mt-1.5 text-base leading-snug text-paper-2">{onStage ? 'Look at the TV. Song 1 starts soon.' : 'Song 1 starts soon.'}</p>
      <ol className="mt-3.5 border-t border-rule">
        {(pub.momentTyped ? MOMENT_RULES : RULES).map((rule, i) => (
          <li key={i} className="grid grid-cols-[30px_minmax(0,1fr)] gap-2 border-b border-rule py-[11px] text-[17px] leading-[1.3]">
            <span aria-hidden className="text-[24px] leading-none text-paper-3 tv-num">
              {i + 1}
            </span>
            <span className="[&_b]:font-bold">{rule}</span>
          </li>
        ))}
      </ol>
      <ul aria-label="Points" className="mt-3.5 flex flex-wrap gap-2">
        {chips.map(([label, points]) => (
          <li key={label} className="rounded-chip bg-overlay px-2.5 py-[7px] text-[15px] font-bold">
            {label} <span className="ml-0.5 text-[18px] leading-none tv-num">+{points}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 text-base leading-snug text-paper-2">{payoutLine(pub.storyteller)}</p>
    </div>
  )
}

/** A guest who doesn't play Lydspor (spec 4.13), in every phase. */
export function SitOut() {
  return (
    <div className="grid gap-1.5">
      <p className="text-[24px] leading-[1.12] font-extrabold tracking-[-0.01em]">You sit this one out.</p>
      <p className="text-base leading-snug text-paper-2">Enjoy the show.</p>
    </div>
  )
}
