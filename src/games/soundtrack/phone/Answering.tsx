import { CaretRightIcon, ImageIcon, MicrophoneStageIcon, MusicNoteIcon, PlusIcon, TextAaIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { clockTime } from '@/components/phone/text'
import { isTypingTarget } from '@/components/phone/useTypingFocus'
import type { AnswerPayload } from '@/games/core/Game'
import {
  letterOf,
  promptKey,
  type Picks,
  type SongPart,
  type SoundtrackPublicState,
  type TypedPart,
} from '@/games/soundtrack/types'
import { preLockDelay } from '@/games/soundtrack/typing'
import type { SessionGame, SubmitResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Board, type BoardRow } from './Board'
import { SongFields } from './Fields'
import { useKeyboardKeep, useNow } from './hooks'
import { answeredParts, bandOf, doubledPhotos, FIELD_PART, FIELD_SONG, fieldId, followsNewSong, missingParts } from './model'
import { PhotoSheet, SwapToast } from './PhotoSheet'
import { useAnswers, type Answers } from './useAnswers'
import { Wall } from './Wall'
import { laterLine, MISSING_ASK, namedLine, quoted, sheetReminder } from './words'

// Lydspor on a guest's phone while songs play, through the last call and
// locked (spec 4.2 to 4.10): Now playing for the song on now, with its two
// typed fields and the wall of photos; Your board with every song played,
// any part changeable in place; the last call's countdown and one-tap rows
// for what is missing; and the board read-only once the answers lock. One
// component throughout, so drafts, the open tab and the toast carry over.

type Tab = 'now' | 'board'

const TAB_SLOT = 'hurra:lydspor:tab:'

/** The tab this phone had open in the round, kept for a reload. */
function storedTab(round: string): Tab {
  try {
    return sessionStorage.getItem(TAB_SLOT + round) === 'board' ? 'board' : 'now'
  } catch {
    return 'now'
  }
}

function storeTab(round: string, tab: Tab) {
  try {
    sessionStorage.setItem(TAB_SLOT + round, tab)
  } catch {
    // Without storage, a reload opens Now playing.
  }
}

/** Leaves the field being typed in, which saves it. */
function leaveField() {
  const active = document.activeElement
  if (isTypingTarget(active)) (active as HTMLElement).blur()
}

/** Seconds left to the lock, whole and never below 0. */
const secondsTo = (lockAt: number, now: number) => Math.max(0, Math.ceil((lockAt - now) / 1000))

const PART_ICON = { title: TextAaIcon, singer: MicrophoneStageIcon, event: ImageIcon } as const

export function Answering({
  game,
  pub,
  locked: lockedPicks,
  myAnswers,
  submit,
  serverNow,
  mediaUrl,
  onStage,
}: {
  game: SessionGame
  pub: SoundtrackPublicState
  /** The guest's answers as they locked (view.mine), once the game has them. */
  locked: Picks | null
  myAnswers: Readonly<Record<string, AnswerPayload>>
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  serverNow: () => number
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  onStage: boolean
}) {
  const round = `${game.id}:${game.started_at ?? ''}`
  const played = pub.playedAt.length
  const { phase, lockAt } = pub
  const now = useNow(serverNow, phase === 'lastCall' ? 250 : 5000, phase !== 'locked')
  // The phone shows the lock as soon as its clock passes lockAt, and sends nothing after it.
  const closedNow = phase === 'locked' || (phase === 'lastCall' && lockAt !== null && now >= lockAt)
  const closed = useCallback(() => phase === 'locked' || (lockAt !== null && serverNow() >= lockAt), [phase, lockAt, serverNow])
  const answers = useAnswers({ round, total: pub.total, played, myAnswers, submit, closed })

  const idPrefix = useId().replace(/:/g, '')
  const [tab, setTabState] = useState<Tab>(() => storedTab(round))
  const [nowSong, setNowSong] = useState(played)
  const [seenSong, setSeenSong] = useState(played)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [open, setOpen] = useState<{ n: number; part: TypedPart } | null>(null)
  const [sheetSong, setSheetSong] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const setTab = useCallback(
    (next: Tab) => {
      storeTab(round, next)
      setTabState(next)
    },
    [round],
  )

  const named = (n: number) => answers.has(n, 'title') && answers.has(n, 'singer') && answers.has(n, 'event')
  // A newer song than the guest has seen on Now playing, not named yet: the banner, and the follow rule.
  const waiting = phase === 'playing' && played > seenSong && !named(played)
  const covered = open !== null || sheetSong !== null

  /** Now playing for the newest song. */
  const follow = useCallback(() => {
    setTab('now')
    setNowSong(played)
    setSeenSong(played)
    setOpen(null)
  }, [played, setTab])

  // A new song (spec 4.2): Now playing takes it as it starts, unless the guest
  // is typing, has a sheet or row open, or is mid-tap; else the banner shows,
  // and the phone follows after 8 seconds untouched.
  const lastTouch = useRef(0)
  useEffect(() => {
    lastTouch.current = Date.now()
    const touch = () => {
      lastTouch.current = Date.now()
    }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    return () => {
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('keydown', touch, true)
    }
  }, [])
  const followState = useRef({ tab, covered })
  useEffect(() => {
    followState.current = { tab, covered }
  })
  const lastSeenPlayed = useRef(played)
  useEffect(() => {
    if (!waiting) return
    let fresh = lastSeenPlayed.current < played
    lastSeenPlayed.current = played
    const check = () => {
      const { tab: shown, covered: busy } = followState.current
      const go = followsNewSong({
        tab: shown,
        typing: isTypingTarget(document.activeElement),
        covered: busy,
        idleMs: Date.now() - lastTouch.current,
        fresh,
      })
      fresh = false
      if (!go) return
      follow()
      // Back to the top of the game, for a guest who had scrolled down its wall.
      const box = rootRef.current?.getBoundingClientRect()
      if (box && box.top < 0 && box.bottom > 0) rootRef.current?.scrollIntoView({ block: 'start' })
    }
    const first = setTimeout(check, 0)
    const timer = setInterval(check, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [waiting, played, follow])

  // Saving the field being typed in: when the page goes hidden, once 3 s before the lock, and at the lock it blurs.
  const { leave } = answers
  const saveFocused = useCallback(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLInputElement)) return
    const n = Number(active.getAttribute(FIELD_SONG))
    const part = active.getAttribute(FIELD_PART)
    if (!Number.isInteger(n) || n < 1 || (part !== 'title' && part !== 'singer')) return
    leave(n, part, active.value)
  }, [leave])
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') saveFocused()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', saveFocused)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', saveFocused)
    }
  }, [saveFocused])
  useEffect(() => {
    if (phase !== 'lastCall' || lockAt === null) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const early = preLockDelay(lockAt, serverNow())
    if (early !== null) timers.push(setTimeout(saveFocused, early))
    timers.push(setTimeout(leaveField, Math.max(0, lockAt - serverNow())))
    return () => timers.forEach(clearTimeout)
  }, [phase, lockAt, serverNow, saveFocused])

  // Taps -------------------------------------------------------------------------------

  function showTab(next: Tab) {
    leaveField()
    setOpen(null)
    if (next === 'now') follow()
    else setTab('board')
  }

  /** A title or singer cell: its row opens with that field focused, in this same tap, so the keyboard opens. */
  function openCell(n: number, part: TypedPart) {
    if (closedNow) return
    flushSync(() => {
      setSheetSong(null)
      setOpen({ n, part })
    })
    document.getElementById(fieldId(idPrefix, n, part))?.focus()
  }

  function closeRow() {
    leaveField()
    setOpen(null)
  }

  function openSheet(n: number) {
    if (closedNow) return
    leaveField()
    setOpen(null)
    setSheetSong(n)
  }

  const thumbUrl = (path: string) => mediaUrl(path, 'thumb')
  const { answered, total } = answeredParts(played, answers.has)
  const doubled = doubledPhotos(answers.events)
  const photoNote = answers.photoNote

  // What the board shows ---------------------------------------------------------------

  const openRows: BoardRow[] = Array.from({ length: played }, (_, i) => {
    const n = i + 1
    const photo = answers.events[i] ?? null
    return {
      n,
      time: pub.playedAt[i] !== undefined ? clockTime(pub.playedAt[i]) : null,
      now: n === played && phase === 'playing',
      photo,
      title: answers.savedText(n, 'title'),
      singer: answers.savedText(n, 'singer'),
      unsent: (['title', 'singer'] as const).filter((part) => answers.unsent(n, part) && focusedKey !== promptKey(n, part)),
      swapped: answers.flash.includes(n),
      doubled: photo !== null && doubled.has(photo),
    }
  })

  const panel = open && !closedNow && (
    <RowPanel
      n={open.n}
      time={pub.playedAt[open.n - 1] !== undefined ? clockTime(pub.playedAt[open.n - 1]) : null}
      photo={answers.events[open.n - 1] ?? null}
      secondsLeft={phase === 'lastCall' && lockAt !== null ? secondsTo(lockAt, now) : null}
      idPrefix={idPrefix}
      answers={answers}
      focusedKey={focusedKey}
      onFocusKey={setFocusedKey}
      onClose={closeRow}
    />
  )

  const board = (
    <Board
      rows={openRows}
      wall={pub.wall}
      thumbUrl={thumbUrl}
      open={open}
      panel={panel}
      onEvent={openSheet}
      onCell={openCell}
    />
  )

  const later = laterLine(played, pub.total)
  const sheetNote = photoNote && photoNote.n === sheetSong ? photoNote.words : null
  const boardNote =
    photoNote && (tab === 'board' || phase !== 'playing') && sheetSong === null ? `Song ${photoNote.n}: ${photoNote.words}` : null

  // The lock ---------------------------------------------------------------------------

  if (closedNow) {
    const picks = lockedPicks
    const lockedRows: BoardRow[] = Array.from({ length: played }, (_, i) => {
      const n = i + 1
      return {
        n,
        time: null,
        now: false,
        photo: picks ? (picks.event[i] ?? null) : (answers.events[i] ?? null),
        title: picks ? (picks.title[i] ?? null) : answers.savedText(n, 'title'),
        singer: picks ? (picks.singer[i] ?? null) : answers.savedText(n, 'singer'),
        unsent: [],
        swapped: false,
        doubled: false,
      }
    })
    const lockedAnswered = lockedRows.reduce((sum, row) => sum + (row.photo !== null ? 1 : 0) + (row.title !== null ? 1 : 0) + (row.singer !== null ? 1 : 0), 0)
    const unsentLines = Array.from({ length: played }, (_, i) => i + 1).flatMap((n) =>
      (['title', 'singer'] as const)
        .filter((part) => answers.unsent(n, part))
        .map((part) => ({ key: promptKey(n, part), n, part, text: answers.fieldText(n, part) })),
    )
    const storyteller = pub.storyteller.trim()
    return (
      <div ref={rootRef} className="grid grid-cols-1">
        <h3 className="text-[24px] leading-[1.12] font-extrabold tracking-[-0.01em]">Your answers are locked.</h3>
        <p className="mt-1.5 text-base leading-snug text-pretty text-paper-2">
          {lockedAnswered} of {played * 3} answered. Up first: song 1.{' '}
          {storyteller !== '' ? `${storyteller} reveals the songs in order and tells each story.` : 'The songs are revealed in order, each with its story.'}
          {onStage ? ' Look at the TV.' : ''}
        </p>
        {unsentLines.length > 0 && (
          <ul className="mt-3 grid gap-1">
            {unsentLines.map((line) => (
              <li key={line.key} className="text-sm leading-snug font-semibold text-paper">
                Song {line.n}’s {line.part} {quoted(line.text)} was not sent before the lock.
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Board rows={lockedRows} wall={pub.wall} thumbUrl={thumbUrl} locked />
        </div>
      </div>
    )
  }

  // The last call ----------------------------------------------------------------------

  if (phase === 'lastCall') {
    const left = lockAt !== null ? secondsTo(lockAt, now) : 0
    const missing = missingParts(played, answers.has)
    const shown = missing.slice(0, 4)
    return (
      <div ref={rootRef} className="grid grid-cols-1">
        <div className="flex items-center gap-3">
          <span className={cn('text-[64px] leading-[0.82] tv-num', left <= 5 ? 'text-gold' : 'text-paper')} aria-hidden>
            {left}
          </span>
          <p role="timer" aria-label={`${left} seconds left`} className="text-[17px] leading-[1.25] font-bold text-paper-2 max-[379px]:text-base">
            {left === 1 ? 'second' : 'seconds'} left to change anything. Then your answers lock.
          </p>
        </div>
        {shown.length > 0 && (
          <div className="mt-3.5 grid gap-2">
            {shown.map(({ n, part }) => (
              <MissingRow key={`${n}.${part}`} n={n} part={part} onOpen={() => (part === 'event' ? openSheet(n) : openCell(n, part))} />
            ))}
            {missing.length > shown.length && (
              <p className="text-sm font-semibold text-paper-2">
                {missing.length - shown.length} more {missing.length - shown.length === 1 ? 'part is' : 'parts are'} empty on the board below.
              </p>
            )}
          </div>
        )}
        {boardNote && (
          <p role="status" className="mt-3 text-base font-semibold">
            {boardNote}
          </p>
        )}
        <div className="mt-4">{board}</div>
        {sheetAndToast()}
      </div>
    )
  }

  // Songs playing ----------------------------------------------------------------------

  const n = Math.min(Math.max(nowSong, 1), played)
  const banner = waiting && !(tab === 'now' && n === played) && (
    <NewSongBanner
      n={played}
      onName={() => {
        leaveField()
        follow()
        rootRef.current?.scrollIntoView({ block: 'start' })
      }}
    />
  )

  return (
    <div ref={rootRef} className="grid scroll-mt-4 grid-cols-1">
      <TabSwitch tab={tab} answered={answered} total={total} onTab={showTab} />
      {banner && <div className="mt-3">{banner}</div>}
      {tab === 'now' ? (
        <NowPlaying
          n={n}
          pub={pub}
          answers={answers}
          idPrefix={idPrefix}
          focusedKey={focusedKey}
          onFocusKey={setFocusedKey}
          thumbUrl={thumbUrl}
          onOpenSheet={openSheet}
          onOpenBoard={() => showTab('board')}
        />
      ) : (
        <div className="mt-3 grid grid-cols-1">
          <p className="text-base leading-snug text-pretty text-paper-2">
            {answered} of {total} answered. Tap any of them to change it.
          </p>
          {boardNote && (
            <p role="status" className="mt-2 text-base font-semibold">
              {boardNote}
            </p>
          )}
          <div className="mt-3.5">{board}</div>
          {later && <p className="mt-3 text-base leading-snug text-paper-2">{later}</p>}
        </div>
      )}
      {sheetAndToast()}
    </div>
  )

  function sheetAndToast() {
    const song = sheetSong
    const reminderFor = (k: number) =>
      sheetReminder(
        pub.playedAt[k - 1] !== undefined ? clockTime(pub.playedAt[k - 1]) : null,
        answers.savedText(k, 'title'),
        answers.savedText(k, 'singer'),
      )
    return (
      <>
        {song !== null && (
          <PhotoSheet
            n={song}
            open
            onClose={() => setSheetSong(null)}
            reminder={reminderFor(song)}
            note={sheetNote}
            photos={pub.wall}
            bandOf={(i) => bandOf(answers.events, song, i)}
            thumbUrl={thumbUrl}
            disabled={answers.photoBusy}
            failed={photoNote?.n === song && photoNote.offline ? photoNote.photo : null}
            onTap={(i) => {
              void answers.tapPhoto(song, i)
              setSheetSong(null)
            }}
          />
        )}
        {answers.notice && <SwapToast notice={answers.notice} busy={answers.photoBusy} onUndo={() => void answers.undo()} />}
      </>
    )
  }
}

/** "Now playing" and "Your board 13 of 15" (narrow: "Board 13 of 15"). */
function TabSwitch({ tab, answered, total, onTab }: { tab: Tab; answered: number; total: number; onTab: (tab: Tab) => void }) {
  const button = (value: Tab, children: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => onTab(value)}
      className={cn(
        'flex h-11 min-w-0 items-center justify-center gap-[7px] rounded-[10px] px-2 text-base font-bold whitespace-nowrap transition-colors max-[379px]:gap-[5px]',
        tab === value ? 'bg-paper text-ink' : 'text-paper-2 hover:text-paper',
      )}
    >
      {children}
    </button>
  )
  return (
    <div role="tablist" aria-label="Lydspor" className="grid grid-cols-2 gap-1 rounded-phone bg-raised p-1">
      {button(
        'now',
        <>
          <MusicNoteIcon className="size-4 shrink-0" />
          Now playing
        </>,
      )}
      {button(
        'board',
        <>
          <span className="max-[379px]:hidden">Your board</span>
          <span className="hidden max-[379px]:inline">Board</span>
          <span className={cn('text-[17px] leading-none tv-num', tab === 'board' ? 'text-ink' : 'text-paper-3')}>
            {answered} of {total}
          </span>
        </>,
      )}
    </div>
  )
}

/** A new song while the guest reads the board or types (spec 4.8). */
function NewSongBanner({ n, onName }: { n: number; onName: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-phone bg-paper py-2 pr-2 pl-3.5 text-ink">
      <MusicNoteIcon weight="bold" className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-[17px] leading-[1.2] font-extrabold">
        Song {n} is playing.
        <span className="block text-sm font-semibold">Or finish here first.</span>
      </p>
      <button
        type="button"
        onClick={onName}
        className="flex h-11 shrink-0 items-center gap-1 rounded-[12px] px-3.5 text-base font-extrabold shadow-[inset_0_0_0_2px_var(--color-ink)] active:bg-ink/10"
      >
        Name it
        <CaretRightIcon weight="bold" className="size-4" />
      </button>
    </div>
  )
}

/** Song n on Now playing (spec 4.3 and 4.4): its two fields, then its photo on the wall. */
function NowPlaying({
  n,
  pub,
  answers,
  idPrefix,
  focusedKey,
  onFocusKey,
  thumbUrl,
  onOpenSheet,
  onOpenBoard,
}: {
  n: number
  pub: SoundtrackPublicState
  answers: Answers
  idPrefix: string
  focusedKey: string | null
  onFocusKey: (key: string | null) => void
  thumbUrl: (path: string) => string
  onOpenSheet: (n: number) => void
  onOpenBoard: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const fields = useRef<HTMLDivElement>(null)
  const eventHead = useRef<HTMLDivElement>(null)
  useKeyboardKeep(fields, heading)
  const typing = focusedKey !== null
  const photo = answers.events[n - 1] ?? null
  const hasTitle = answers.has(n, 'title')
  const hasSinger = answers.has(n, 'singer')
  const note = answers.photoNote && answers.photoNote.n === n ? answers.photoNote : null
  // Earlier songs left without a photo (a take, or never picked): one-tap rows, a few at most.
  const lost = Array.from({ length: n - 1 }, (_, i) => i + 1).filter((k) => !answers.has(k, 'event')).slice(0, 3)
  const outlined: TypedPart[] = photo === null ? [] : [...(hasTitle ? [] : ['title' as const]), ...(hasSinger ? [] : ['singer' as const])]

  return (
    <section aria-labelledby={`${idPrefix}-now`} className="mt-4 grid grid-cols-1">
      <h3 id={`${idPrefix}-now`} ref={heading} className="text-[24px] leading-[1.12] font-extrabold tracking-[-0.01em]">
        Name song {n}.
      </h3>
      {!typing && <p className="mt-1.5 text-base leading-snug text-pretty text-paper-2">Close spelling counts. Change it until the last call.</p>}
      <div ref={fields} className="mt-3">
        <SongFields
          n={n}
          idPrefix={idPrefix}
          answers={answers}
          focusedKey={focusedKey}
          onFocusKey={onFocusKey}
          outlined={outlined}
          onDone={() => {
            // Done: the event's heading goes to the top, with the wall under it.
            requestAnimationFrame(() => eventHead.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
          }}
        />
      </div>

      <div ref={eventHead} className="mt-[22px] scroll-mt-3">
        <p className="on-air text-[13px] text-paper-2">
          <span className="mr-1 text-paper-3">3</span>Event
        </p>
        <p className="mt-1 text-[20px] leading-[1.15] font-extrabold">Which photo is song {n} from?</p>
        <p role="status" className={cn('mt-1.5 text-base leading-snug', note ? 'font-semibold text-paper' : 'text-paper-2')}>
          {note ? note.words : 'Tap its photo. One photo per song.'}
        </p>
      </div>
      <div className="mt-3.5">
        <Wall
          photos={pub.wall}
          bandOf={(i) => bandOf(answers.events, n, i)}
          thumbUrl={thumbUrl}
          disabled={answers.photoBusy}
          failed={note?.offline ? note.photo : null}
          label={`Photos for song ${n}`}
          onTap={(i) => {
            leaveField()
            void answers.tapPhoto(n, i)
          }}
        />
      </div>

      {photo !== null && (
        <div className="mt-5 grid grid-cols-1 gap-3">
          <div>
            <p className="text-[20px] leading-tight font-extrabold">{namedLine(n, hasTitle, hasSinger)}</p>
            {hasTitle && hasSinger && <p className="mt-1 text-base leading-snug text-paper-2">Talk it over. Change anything until the last call.</p>}
          </div>
          {lost.map((k) => (
            <MissingRow key={k} n={k} part="event" onOpen={() => onOpenSheet(k)} />
          ))}
          <button
            type="button"
            onClick={onOpenBoard}
            className="flex min-h-11 items-center gap-1.5 justify-self-start text-[17px] font-bold underline decoration-paper-3 underline-offset-4"
          >
            Open your board
            <CaretRightIcon weight="bold" className="size-4" />
          </button>
        </div>
      )}
    </section>
  )
}

/** A missing part as an outlined one-tap row: "Song 7: who sings it?" */
function MissingRow({ n, part, onOpen }: { n: number; part: SongPart; onOpen: () => void }) {
  const Icon = PART_ICON[part]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-phone px-4 text-left text-[17px] font-bold shadow-[inset_0_0_0_2px_var(--color-rule)] active:bg-overlay"
    >
      <Icon className="size-5 shrink-0 text-paper-2" />
      <span className="min-w-0 flex-1">
        Song {n}: <span className="font-semibold text-paper-2">{MISSING_ASK[part]}</span>
      </span>
      <PlusIcon weight="bold" className="size-5 shrink-0 text-paper-2" />
    </button>
  )
}

/** An opened board row's fields (spec 4.6.1), right under the row. */
function RowPanel({
  n,
  time,
  photo,
  secondsLeft,
  idPrefix,
  answers,
  focusedKey,
  onFocusKey,
  onClose,
}: {
  n: number
  time: string | null
  photo: number | null
  secondsLeft: number | null
  idPrefix: string
  answers: Answers
  focusedKey: string | null
  onFocusKey: (key: string | null) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  // The opened row above the panel is the top the keyboard rule keeps in view.
  useKeyboardKeep(panel)
  // No-break spaces keep "Photo C." and "at 21:04" whole when the line wraps.
  const facts = [time ? `Started at\u00a0${time}.` : null, photo !== null ? `Photo\u00a0${letterOf(photo)}.` : 'No photo yet.']
    .filter(Boolean)
    .join(' ')
  return (
    <div ref={panel} className="rounded-phone bg-raised px-3 pt-2.5 pb-3">
      <div className="flex items-center gap-2.5">
        <p className="min-w-0 flex-1 text-[15px] leading-tight text-paper-2 max-[379px]:text-sm">
          <b className="mr-1.5 text-[17px] font-extrabold text-paper">Song {n}</b>
          {facts}
        </p>
        {/* The big countdown is scrolled away while a row is open: its seconds stand here. */}
        {secondsLeft !== null && (
          <span role="timer" aria-label={`${secondsLeft} seconds left`} className={cn('shrink-0 text-[20px] leading-none whitespace-nowrap tv-num', secondsLeft <= 5 ? 'text-gold' : 'text-paper')}>
            {secondsLeft} s
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-10 shrink-0 rounded-[10px] px-3 text-base font-extrabold underline decoration-paper-3 underline-offset-4"
        >
          Close
        </button>
      </div>
      <SongFields
        n={n}
        idPrefix={idPrefix}
        answers={answers}
        focusedKey={focusedKey}
        onFocusKey={onFocusKey}
        onDone={onClose}
        className="mt-2"
      />
    </div>
  )
}
