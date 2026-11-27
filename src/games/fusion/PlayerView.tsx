import { CheckIcon } from '@phosphor-icons/react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import type { AnswerPayload } from '@/games/core/Game'
import { sameName } from '@/games/core/names'
import type { FusionGame } from '@/games/fusion/logic'
import { isLockedIn, lockedPick, NO_LOCK, sendLock, type LockState, type Pick2 } from '@/games/fusion/lock'
import { LabelChip, NameChip, PictureImage } from '@/games/fusion/parts'
import {
  askingCase,
  doneWords,
  lobbyWords,
  lockedWords,
  outcomeFor,
  outcomeHead,
  outcomeLine,
  outcomePoints,
  pickLine,
  placeParts,
  timeUpWords,
  waitWords,
  wallWords,
  type Words,
} from '@/games/fusion/phoneLines'
import { AskHeader, GuessRow, LockBar, MomentCard, NamePicker, PlaceLine, TwoNames } from '@/games/fusion/phoneParts'
import {
  countsLine,
  readPublic,
  readView,
  revealedCount,
  type FusionCurrent,
  type FusionPlayerView,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionReveal,
} from '@/games/fusion/shapes'
import { choiceOf, guessOptions, ownName, playerNamed, shortName, shortNames, togglePick } from '@/games/fusion/view'
import type { PlayerViewProps } from '@/games/types'
import { useMomentSoundAt, useServerTime } from '@/lib/gameClock'
import { usePlayerPhoto } from '@/lib/photoIndex'
import type { Player, PromptState, SessionGame, SubmitResult } from '@/lib/types'
import { cn } from '@/lib/utils'

// Participant fusion on a guest's phone (spec 6.3; docs/identity.md,
// Participant fusion on a phone). The TV is the show: the lobby sends eyes
// there; the wall says what comes next and how you are doing; while a picture
// is asked, first "Look at the TV." while the TV shows which picture it is,
// then pick its two names and lock in, the screen's one gold step (Show my
// code steps aside for the timed prompt). Names only while picking: no
// photos, no tokens. Everyone guesses every picture, the two in it too (their
// own name is never offered, except in teams, where it counts); the reveal says what you got, with the two
// people's own photos. The phone draws the strap above it ("Picture 4 of 12",
// phoneStrap in index.ts).

/** The reveal's sound plays only this soon after the reveal: a phone opened later stays quiet. */
const FRESH_MS = 15_000
/** And this long after the reveal reaches the phone, under the TV's sting. */
const SOUND_AFTER_MS = 2000

/** A picture whose two people are out. */
type RevealedPicture = FusionPublicPicture & { revealed: FusionReveal }

export default function PlayerView({
  game,
  players,
  player,
  publicState,
  view: rawView,
  prompts,
  myAnswers,
  onStage,
  submit,
  serverNow,
  mediaUrl,
}: PlayerViewProps<FusionGame>) {
  const pub = readPublic(publicState)
  const view = readView(rawView)
  const own = ownName(game, player)
  if (!pub) return <p className="py-8 text-center text-paper-2">Getting the pictures ready…</p>

  const current = pub.current ? pub.pictures.find((p) => p.n === pub.current!.n) : undefined
  switch (pub.phase) {
    case 'lobby':
      return <Said words={lobbyWords(onStage, pub.rules)} />
    case 'wall':
      return <Wall pub={pub} view={view} player={player} own={own} myAnswers={myAnswers} onStage={onStage} mediaUrl={mediaUrl} />
    case 'asking':
      return current && pub.current ? (
        <Asking
          key={pub.current.key}
          picture={current}
          current={pub.current}
          prompt={prompts.find((p) => p.key === pub.current!.key)}
          saved={myAnswers[pub.current.key]}
          own={own}
          players={players}
          onStage={onStage}
          submit={submit}
          serverNow={serverNow}
          mediaUrl={mediaUrl}
        />
      ) : null
    case 'reveal':
      return current?.revealed && pub.current ? (
        <Revealed
          key={pub.current.key}
          game={game}
          pub={pub}
          picture={current as RevealedPicture}
          revealedAt={pub.current.revealedAt ?? current.revealed.at}
          view={view}
          mine={choiceOf(myAnswers[pub.current.key])}
          player={player}
          own={own}
          players={players}
          serverNow={serverNow}
          mediaUrl={mediaUrl}
        />
      ) : null
    case 'done':
      return (
        <div className="grid grid-cols-1 gap-4">
          <Said words={doneWords(game.title)} />
          <PlaceLine parts={placeParts(view, revealedCount(pub) > 0)} />
        </div>
      )
  }
}

/** A head, a line under it and the reading text: the lobby's, the wall's. */
function Said({ words, children }: { words: Words; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <p className="text-phone-head leading-tight font-extrabold">{words.head}</p>
        {words.line && <p className="mt-1 text-lg font-semibold">{words.line}</p>}
      </div>
      {words.body && <p className="text-paper-2">{words.body}</p>}
      {children}
    </div>
  )
}

/** The wall, between pictures: what comes next, your place, and your guesses so far, newest first. */
function Wall({
  pub,
  view,
  player,
  own,
  myAnswers,
  onStage,
  mediaUrl,
}: {
  pub: FusionPublicState
  view: FusionPlayerView | null
  player: Player
  /** Their own name, which counts for nothing outside teams (ownName). */
  own: string | null
  myAnswers: Readonly<Record<string, AnswerPayload>>
  onStage: boolean
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  const id = useId()
  const revealed = pub.pictures
    .filter((p): p is RevealedPicture => p.revealed !== null)
    .sort((a, b) => b.revealed.step - a.revealed.step)
  return (
    <Said words={wallWords(revealed.length, pub.pictures.length, onStage)}>
      <PlaceLine parts={placeParts(view, revealed.length > 0)} />
      {revealed.length > 0 && (
        <section aria-labelledby={id} className="grid grid-cols-1 gap-2">
          <h3 id={id} className="text-sm font-bold text-paper-2">
            Your guesses
          </h3>
          <ul className="grid grid-cols-1 gap-2">
            {revealed.map((picture) => {
              const outcome = outcomeFor(picture, own, view, choiceOf(myAnswers[picture.key]))
              const points = outcomePoints(outcome, pub.rules)
              const who = picture.revealed.names.map((name) => (sameName(name, player.name) ? 'You' : name))
              return (
                <GuessRow
                  key={picture.n}
                  picture={picture}
                  who={`${who[0]} and ${who[1]}`}
                  outcome={outcomeLine(outcome, points)}
                  scored={points > 0}
                  mediaUrl={mediaUrl}
                />
              )
            })}
          </ul>
        </section>
      )}
    </Said>
  )
}

/**
 * A picture being guessed. While the TV shows which picture it is (until the
 * countdown starts), "Look at the TV."; then pick two names and lock in: the
 * lock shows at once (Sending), then locked in; a refusal brings the picker
 * back with the picks and the server's words. The names are the ones the
 * guess offers (everyone who has joined and every name in the pictures), never
 * this guest's own; names only, no photos. The two in the picture pick like
 * anyone, and score like anyone.
 */
function Asking({
  picture,
  current,
  prompt,
  saved,
  own,
  players,
  onStage,
  submit,
  serverNow,
  mediaUrl,
}: {
  picture: FusionPublicPicture
  current: FusionCurrent
  prompt: PromptState | undefined
  saved: AnswerPayload | undefined
  /** Their own name, left out of the names outside teams (ownName). */
  own: string | null
  players: Player[]
  onStage: boolean
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  serverNow: () => number
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  const [pick, setPick] = useState<string[]>([])
  const [lock, setLock] = useState<LockState>(NO_LOCK)
  const names = useMemo(() => guessOptions(prompt?.spec, players, own), [prompt?.spec, players, own])
  const short = useMemo(() => shortNames(names), [names])
  const lockedIn = isLockedIn(saved, lock)
  const sending = lock.kind === 'sending'
  const now = useServerTime(serverNow, 250, !lockedIn)
  // Time's up by the database clock, a closed prompt, or the database saying so.
  const over = now >= current.endsAt || (prompt?.closed_at ?? null) !== null || (lock.kind === 'refused' && lock.closed)
  const view = askingCase({ lockedIn, sending, over })
  // A second tap before the first one's render can't send twice.
  const inFlight = useRef(false)
  const nameFor = (name: string) => shortName(short, name)

  // The TV is still showing which picture it is: the picture and the picker come once it is in.
  if (view === 'picking' && now < current.startsAt && !sending) return <Said words={waitWords(onStage)} />

  const header = <AskHeader picture={picture} endsAt={current.endsAt} closed={over} serverNow={serverNow} mediaUrl={mediaUrl} />

  if (view === 'locked') {
    // Locked in means a lock to show: this tap's, or the one read back.
    const two = lockedPick(saved, lock)!
    const twoNames = two.map(nameFor)
    const words = lockedWords(twoNames, onStage)
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <MomentCard head={words.head} line={words.line}>
          <TwoNames names={two} />
        </MomentCard>
      </div>
    )
  }
  if (view === 'timeUp') {
    const words = timeUpWords(lock.kind === 'refused' && lock.closed ? lock.message : null)
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <MomentCard head={words.head} line={words.line} />
      </div>
    )
  }

  // A name no longer offered (a prompt from before names, the guests changed) drops out of the picks.
  const picks = pick.filter((name) => names.some((offered) => sameName(offered, name)))
  const shown = sending ? lock.pick : picks
  const shownNames = shown.map(nameFor)
  const canRetry = lock.kind !== 'refused' || lock.retry
  const canLock = picks.length === 2 && !sending && !over && canRetry

  function lockIn() {
    if (!canLock || inFlight.current) return
    inFlight.current = true
    void sendLock(picture.key, [picks[0], picks[1]], submit, setLock).finally(() => {
      inFlight.current = false
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {header}
      {/* Two lines kept for it, so the names stay put as it changes. */}
      <p role="status" className="min-h-[2lh] text-[1.0625rem] leading-snug text-paper-2">
        {pickLine(shownNames, lock)}
      </p>
      <NamePicker
        names={names}
        short={short}
        pick={shown}
        busy={sending || !canRetry}
        onToggle={(name) => {
          setPick((current) => togglePick(current, name))
          // A new pick after a refusal starts afresh.
          if (lock.kind === 'refused') setLock(NO_LOCK)
        }}
      />
      <LockBar names={shownNames} sending={sending} canLock={canLock} onLock={lockIn} />
    </div>
  )
}

/**
 * The reveal on your phone, the phone's version of the TV's: what you got and
 * your points first (in reach the moment it lands: the wall comes back by
 * itself after 10 s), then the picture large and square across the card with
 * its label chip, "It was" and the two people side by side as large squares
 * named on the TV's tilted paper chips, how the room did, your two picks and
 * your place. Each person is their own photo from the settings, else their
 * profile photo, else their token; a guest on the list who never came keeps
 * the name the reveal carries. The images show their thumbnail at once and
 * the full image over it once loaded.
 */
function Revealed({
  game,
  pub,
  picture,
  revealedAt,
  view,
  mine,
  player,
  own,
  players,
  serverNow,
  mediaUrl,
}: {
  game: SessionGame
  pub: FusionPublicState
  picture: RevealedPicture
  revealedAt: number | null
  view: FusionPlayerView | null
  mine: Pick2 | null
  player: Player
  own: string | null
  players: readonly Player[]
  serverNow: () => number
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  const id = useId()
  const outcome = outcomeFor(picture, own, view, mine)
  const points = outcomePoints(outcome, pub.rules)
  const names = picture.revealed.names
  // When the reveal reached this phone: its sound follows 2 s later, only while fresh.
  const [arrived] = useState(serverNow)
  const fresh = revealedAt !== null && arrived - revealedAt < FRESH_MS
  const moment = fresh ? `hurra:fusion:${game.id}:${game.started_at ?? 0}:${picture.key}:result` : null
  useMomentSoundAt(moment, points > 0 ? 'coin' : 'sad', arrived + SOUND_AFTER_MS, serverNow)

  return (
    <div className="grid grid-cols-1 gap-5">
      <div data-reveal-result="" className="grid grid-cols-1 gap-1 duration-300 animate-in fade-in-0 motion-reduce:animate-none">
        <p className="text-phone-head leading-tight font-extrabold">{outcomeHead(outcome)}</p>
        {points > 0 && (
          <p className="flex items-baseline gap-2 text-[1.0625rem] font-semibold text-paper-2">
            <span className="text-[1.875rem] leading-none text-paper tv-num">{`+${points}`}</span>
            {points === 1 ? 'point' : 'points'}
          </p>
        )}
      </div>

      <div className="relative">
        <PictureImage picture={picture} mediaUrl={mediaUrl} size="full" fit="cover" className="aspect-square w-full rounded-tile" labelClassName="text-[28cqw]" />
        {picture.image !== null && (
          <span className="pointer-events-none absolute top-3 left-3 flex max-w-[85%]">
            <LabelChip label={picture.label} className="text-[1.375rem]" />
          </span>
        )}
      </div>

      <section aria-labelledby={id} className="grid grid-cols-1 gap-2.5">
        <h3 id={id} className="text-lg font-bold text-paper-2">
          It was
        </h3>
        <ul aria-label={`${picture.label} was ${names[0]} and ${names[1]}`} className="grid grid-cols-2 gap-3 pb-5">
          {names.map((name, i) => (
            <RevealPerson
              key={`${i}:${name}`}
              slot={i === 0 ? 0 : 1}
              name={name}
              players={players}
              you={sameName(name, player.name)}
              path={picture.revealed.originals[i]}
              fresh={fresh}
              mediaUrl={mediaUrl}
            />
          ))}
        </ul>
        <p className="text-[1.0625rem] leading-snug text-paper-2">{countsLine(picture.revealed)}</p>
      </section>

      {mine && (
        <section aria-labelledby={`${id}-guess`} className="grid grid-cols-1 gap-2">
          <h3 id={`${id}-guess`} className="text-sm font-bold text-paper-2">
            Your guess
          </h3>
          <ul className="grid grid-cols-1 gap-2">
            {mine.map((pick) => {
              const right = (own === null || !sameName(pick, own)) && names.some((name) => sameName(name, pick))
              const guest = playerNamed(players, pick)
              return (
                <li key={pick} className={cn('flex min-h-14 items-center gap-3 rounded-phone py-2 pr-4 pl-2', right ? 'bg-paper text-ink' : 'bg-overlay')}>
                  <Avatar name={pick} playerId={guest?.id} src={guest ? undefined : null} className="size-10 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-bold">{pick}</span>
                  {right ? (
                    <span className="flex shrink-0 items-center gap-1 font-bold">
                      <CheckIcon weight="bold" aria-hidden className="size-5" />
                      Right
                    </span>
                  ) : (
                    <span className="shrink-0 font-semibold text-paper-2">Not in it</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <PlaceLine parts={placeParts(view, true)} />
    </div>
  )
}

/**
 * One of the two in the revealed picture, a square half the card wide: their
 * own photo from the settings, else the profile photo of the guest with their
 * name, else a token (whose slate names them already, so it gets no chip),
 * named on a tilted paper chip across its foot as on the TV ("You" for this
 * phone's guest). Fresh, each comes in from its side, the first, then the
 * second.
 */
function RevealPerson({
  slot,
  name,
  players,
  you,
  path,
  fresh,
  mediaUrl,
}: {
  slot: 0 | 1
  name: string
  players: readonly Player[]
  you: boolean
  path: string | null
  fresh: boolean
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  // The guest here with this name, if anyone joined with it: their profile photo and token.
  const id = playerNamed(players, name)?.id
  const photo = usePlayerPhoto(id, id === undefined ? undefined : name)
  const first = firstName(name)
  const named = path !== null || photo !== null
  return (
    <li
      className={cn(
        'relative aspect-square',
        fresh && 'duration-500 animate-in fade-in-0 [animation-fill-mode:backwards] motion-reduce:animate-none',
        fresh && (slot === 0 ? 'slide-in-from-left-6 [animation-delay:200ms]' : 'slide-in-from-right-6 [animation-delay:450ms]'),
      )}
    >
      {path !== null ? (
        <PictureImage
          picture={{ label: first, image: path }}
          mediaUrl={mediaUrl}
          size="full"
          fit="cover"
          alt={you ? 'Your own photo' : `${first}'s own photo`}
          className="size-full rounded-tile"
          labelClassName="text-[18cqw]"
        />
      ) : (
        <Avatar name={name} playerId={id} src={id === undefined ? null : undefined} className="size-full" />
      )}
      {named && (
        <span className="absolute inset-x-0 bottom-0 flex translate-y-1/2 justify-center px-[6%]">
          <NameChip
            name={you ? 'You' : first}
            first={slot === 0}
            className={cn('text-[1.625rem]', fresh && 'animate-tab-land [animation-delay:700ms] motion-reduce:animate-none')}
          />
        </span>
      )}
    </li>
  )
}

/** "Marie-Louise" for Marie-Louise Christensen. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name
