import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { clockTime } from '@/components/tv/clock'
import type { TvViewProps } from '@/games/types'
import { cn } from '@/lib/utils'
import type { SoundtrackGame } from './logic'
import { readPublic } from './read'
import Final from './tv/Final'
import { linesOver, overflows, useNow, useStepDown } from './tv/hooks'
import { Pips, RunningOrder, Wall } from './tv/parts'
import Reveal from './tv/Reveal'
import TopFive from './tv/TopFive'
import { LAST_CALL_LINE, lobbyLine, lockedLine, PLAYING_LINE, pointChips, revealsLine, RULES, typedWords } from './tv/words'
import { promptKey, type SoundtrackPublicState } from './types'

/** The house easing (docs/identity.md, Motion). */
const EASE_OUT = [0.22, 1, 0.36, 1] as const

/**
 * Lydspor on the TV stage (.design/lydspor/spec.md, section 9): the lobby
 * with the rules and the wall, each song playing with how many have typed
 * something and the running order, the last call's countdown, the lock, each
 * reveal, the top 5 and, once crowned, the winner. The strap above says where
 * the round is ("Song 5 of 8"). The TV never shows a typed answer, and makes
 * no sound from Play song 1 to the crown: Lydspor announces nothing then.
 */
export default function TvView(props: TvViewProps<SoundtrackGame>) {
  const { game, players, tallies, serverNow, mediaUrl, finished } = props
  const pub = readPublic(props.publicState)
  if (!pub) return <Waiting>Getting {game.title} ready…</Waiting>
  if (finished || pub.phase === 'done') return <Final {...props} />

  switch (pub.phase) {
    case 'lobby':
    case 'playing':
    case 'lastCall':
    case 'locked':
      // One wall from the lobby to the lock, so its photos stay put while the column beside it changes.
      return (
        <BesideTheWall pub={pub} mediaUrl={mediaUrl}>
          {pub.phase === 'lobby' ? (
            <Lobby pub={pub} />
          ) : (
            <OnAir key={`${pub.phase}:${pub.playedAt.length}`} pub={pub} tallies={tallies} serverNow={serverNow} />
          )}
        </BesideTheWall>
      )
    case 'reveal':
      return pub.reveal ? (
        <Reveal key={pub.reveal.n} pub={pub} reveal={pub.reveal} mediaUrl={mediaUrl} />
      ) : (
        <Waiting>The first song is coming up…</Waiting>
      )
    case 'standings':
      return <TopFive pub={pub} players={players} mediaUrl={mediaUrl} />
  }
}

function Waiting({ children }: { children: ReactNode }) {
  return <p className="m-auto text-tv-name text-paper-2 short:text-tv-band low:text-tv-field">{children}</p>
}

/**
 * The left column beside the wall, and the wall. The column takes 42 percent
 * of the stage (44 on a short screen and 48 on a low one, so the running
 * order keeps eight start times on one row), the wall the rest, both from the
 * stage's top as in the mockup.
 */
function BesideTheWall({ pub, mediaUrl, children }: { pub: SoundtrackPublicState; mediaUrl: TvViewProps['mediaUrl']; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 gap-[4.5%] short:gap-[4%]">
      {children}
      <Wall wall={pub.wall} mediaUrl={mediaUrl} className="h-full flex-1" />
    </div>
  )
}

/** The column's room: it steps its type down while anything runs past it. */
const columnTooBig = (el: HTMLElement) => overflows(el) || linesOver(el)

/** The lobby's first line, 66 px at 1080p and stepping down while it takes a fourth line. */
const LOBBY_HEAD = [
  'text-tv-answer short:text-tv-score low:text-tv-name',
  'text-tv-score short:text-tv-name low:text-tv-band',
  'text-tv-name short:text-tv-band low:text-tv-field',
  'text-tv-band short:text-tv-field low:text-tv-body',
] as const

/**
 * Before song 1: the host's intro (or "Eight songs, eight events. Pair each song with its event."), the
 * rules in the phone's words, what a song gives and who tells the stories,
 * beside the wall the phones show, so tables can start looking.
 */
function Lobby({ pub }: { pub: SoundtrackPublicState }) {
  // The first step drops the closing line (the phones say it too); the steps after it shrink the first line.
  const [ref, step] = useStepDown<HTMLDivElement>(LOBBY_HEAD.length, columnTooBig)
  const head = LOBBY_HEAD[Math.max(0, step - 1)]
  return (
    <div ref={ref} className="flex w-[42%] min-w-0 shrink-0 flex-col overflow-hidden short:w-[44%] low:w-[48%]">
      <h2 data-fit-lines="3" className={cn('font-extrabold text-balance text-paper', head, 'leading-[1.08]')}>
        {lobbyLine(pub)}
      </h2>
      <ol className="mt-8 grid gap-4 short:mt-6 short:gap-3 low:mt-4 low:gap-2">
        {RULES.map((rule, i) => (
          <li key={i} className="flex min-w-0 items-baseline gap-5 short:gap-4">
            <span className="w-[1ch] shrink-0 tv-num text-tv-field text-paper-3 short:text-tv-body low:text-tv-tab">{i + 1}</span>
            <span className="min-w-0 text-tv-body leading-[1.3] text-pretty text-paper short:text-tv-tab low:text-tv-floor">{rule}</span>
          </li>
        ))}
      </ol>
      <ul aria-label="Points per song" className="mt-8 flex flex-wrap gap-3 short:mt-6 low:mt-4">
        {pointChips(pub.points).map((chip) => (
          <li key={chip.label} className="flex items-baseline gap-2.5 rounded-chip bg-overlay px-4 py-2 short:px-3.5 short:py-1.5">
            <span className="text-tv-body font-semibold text-paper short:text-tv-tab low:text-tv-floor">{chip.label}</span>
            <span className="tv-num text-tv-band text-paper short:text-tv-field low:text-tv-tab">+{chip.points}</span>
          </li>
        ))}
      </ul>
      {step === 0 && (
        <p className="mt-6 text-tv-body leading-[1.3] text-balance text-paper-2 short:mt-4 short:text-tv-tab low:mt-3 low:text-tv-floor">
          {revealsLine(pub.storyteller)}
        </p>
      )}
    </div>
  )
}

/** The heading of a song playing or the lock, 86 px at 1080p and stepping down while it takes a third line. */
const HEAD = [
  'text-tv-question short:text-tv-answer low:text-tv-score',
  'text-tv-answer short:text-tv-score low:text-tv-name',
  'text-tv-score short:text-tv-name low:text-tv-band',
  'text-tv-name short:text-tv-band low:text-tv-field',
] as const

/**
 * While songs play, at the last call and once the answers are locked: the
 * same column beside the wall. Playing: "Song 5 is playing.", what to do, the
 * pips and how many have typed a title, a singer and a photo for this song
 * (counts only, never an answer), and the running order with each start
 * time. The last call: the countdown in place of the heading. Locked: when
 * they locked, and what comes next.
 */
function OnAir({ pub, tallies, serverNow }: { pub: SoundtrackPublicState; tallies: Readonly<Record<string, number>>; serverNow: () => number }) {
  const reduce = useReducedMotion()
  const n = pub.playedAt.length
  // The last step drops the line under the heading; the steps before it shrink the heading.
  const [ref, step] = useStepDown<HTMLDivElement>(HEAD.length, columnTooBig)
  const head = HEAD[Math.min(step, HEAD.length - 1)]
  const line = step < HEAD.length

  return (
    <div ref={ref} className="flex w-[42%] min-w-0 shrink-0 flex-col overflow-hidden short:w-[44%] low:w-[48%]">
      {pub.phase === 'lastCall' ? (
        <Countdown lockAt={pub.lockAt} serverNow={serverNow}>
          {line && <Line>{LAST_CALL_LINE}</Line>}
        </Countdown>
      ) : (
        <motion.h2
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          data-fit-lines="2"
          className={cn('font-extrabold tracking-[-0.01em] text-balance text-paper', head, 'leading-[1.04]')}
        >
          {pub.phase === 'playing' ? (
            `Song ${n} is playing.`
          ) : (
            <>
              Answers locked
              {pub.lockedAt !== null && (
                <>
                  {' '}
                  at <span className="tv-num">{clockTime(pub.lockedAt)}</span>
                </>
              )}
            </>
          )}
        </motion.h2>
      )}
      {line && pub.phase !== 'lastCall' && <Line>{pub.phase === 'playing' ? PLAYING_LINE : lockedLine(pub.storyteller)}</Line>}
      {pub.phase === 'playing' && n > 0 && <Typed n={n} playing={pub.playing} tallies={tallies} />}
      <RunningOrder total={pub.total} playedAt={pub.playedAt} playing={pub.phase === 'playing'} className="mt-10 shrink-0 short:mt-7 low:mt-4" />
    </div>
  )
}

/** The line under the heading: what to do now. */
function Line({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 text-tv-body leading-[1.3] text-pretty text-paper-2 short:mt-4 short:text-tv-tab low:mt-3 low:text-tv-floor">{children}</p>
  )
}

/**
 * How many have typed this song's title, as pips and "19 of 22 have typed a
 * title", then its singer and photo counts. A tally counts first answers
 * only, so the numbers never go down. "Of" is the guests who can score.
 */
function Typed({ n, playing, tallies }: { n: number; playing: number; tallies: Readonly<Record<string, number>> }) {
  const title = tallies[promptKey(n, 'title')] ?? 0
  const singer = tallies[promptKey(n, 'singer')] ?? 0
  const photo = tallies[promptKey(n, 'event')] ?? 0
  const of = Math.max(playing, title)
  return (
    <div
      role="group"
      aria-label={`${title} of ${of} ${typedWords(title)}, ${singer} a singer, ${photo} a photo`}
      className="mt-9 shrink-0 short:mt-6 low:mt-4"
    >
      <Pips count={title} total={of} />
      <p aria-hidden className="mt-4 flex items-baseline gap-3.5 whitespace-nowrap short:mt-3 low:mt-2">
        <span className="tv-num text-tv-name text-paper short:text-tv-band low:text-tv-field">
          {title} of {of}
        </span>
        <span className="text-tv-field font-semibold text-paper short:text-tv-body low:text-tv-tab">{typedWords(title)}</span>
      </p>
      <p aria-hidden className="mt-1 text-tv-body font-medium whitespace-nowrap text-paper-2 short:text-tv-tab low:text-tv-floor">
        <span className="tv-num text-paper">{singer}</span> a singer, <span className="tv-num text-paper">{photo}</span> a photo
      </p>
    </div>
  )
}

/** The countdown turns gold for its last seconds (docs/identity.md, The quiz on the TV), never pink. */
const URGENT_MS = 5000

/**
 * The last call's seconds as one big figure in the condensed numerals, with
 * "seconds left" under it and then `children` (what to do): paper, gold for
 * the last 5 seconds, paper-3 at zero with "Locking the answers" alone while
 * the answers lock. No sound: Lydspor stays quiet until the crown.
 */
function Countdown({ lockAt, serverNow, children }: { lockAt: number | null; serverNow: () => number; children?: ReactNode }) {
  const now = useNow(serverNow, 250)
  const left = lockAt === null ? 0 : lockAt - now
  const seconds = Math.max(0, Math.ceil(left / 1000))
  const over = seconds === 0
  return (
    <div role="timer" aria-label={over ? 'Locking the answers' : `${seconds} seconds left`} className="flex shrink-0 flex-col items-start">
      <span
        aria-hidden
        className={cn(
          'tv-num text-tv-count transition-colors duration-300 short:text-tv-lead low:text-tv-cheer',
          over ? 'text-paper-3' : left <= URGENT_MS ? 'text-gold' : 'text-paper',
        )}
      >
        {seconds}
      </span>
      <span aria-hidden className="mt-2 text-tv-body font-semibold whitespace-nowrap text-paper-2 short:text-tv-tab low:mt-1 low:text-tv-floor">
        {over ? 'Locking the answers' : seconds === 1 ? 'second left' : 'seconds left'}
      </span>
      {!over && children}
    </div>
  )
}
