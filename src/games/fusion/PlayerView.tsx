import { CheckIcon } from '@phosphor-icons/react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import type { AnswerPayload, PlayerId } from '@/games/core/Game'
import type { FusionGame } from '@/games/fusion/logic'
import { isLockedIn, lockedPick, NO_LOCK, sendLock, type LockState, type Pick2 } from '@/games/fusion/lock'
import { Pair, LabelChip, PictureArt } from '@/games/fusion/parts'
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
  showingWords,
  timeUpWords,
  wallWords,
  type Words,
} from '@/games/fusion/phoneLines'
import { AskHeader, GuestPicker, GuessRow, LockBar, MomentCard, PlaceLine, TwoTokens } from '@/games/fusion/phoneParts'
import {
  countsLine,
  readPublic,
  readView,
  revealedCount,
  showingIndex,
  type FusionPlayerView,
  type FusionPublicPicture,
  type FusionPublicState,
  type FusionReveal,
} from '@/games/fusion/shapes'
import { choiceOf, nameOf, shortNames, togglePick } from '@/games/fusion/view'
import type { PlayerViewProps } from '@/games/types'
import { useMomentSoundAt, useServerTime } from '@/lib/gameClock'
import type { Player, PromptState, SessionGame, SubmitResult } from '@/lib/types'
import { cn } from '@/lib/utils'

// Participant fusion on a guest's phone (spec 6.3; docs/identity.md,
// Participant fusion on a phone). The TV is the show: the lobby and the
// showing send eyes there; the wall says what comes next and how you are
// doing; while a picture is asked, pick its two guests and lock in, the
// screen's one gold step (Show my code steps aside for the timed prompt). The
// two in it get the same picker, told "This one is you." and that their lock
// won't count, so a glance from the next seat can't tell; the reveal says what
// you got. The phone draws the strap above it ("Picture 4 of 12", phoneStrap
// in index.ts).

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
  if (!pub) return <p className="py-8 text-center text-paper-2">Getting the pictures ready…</p>

  const current = pub.current ? pub.pictures.find((p) => p.n === pub.current!.n) : undefined
  switch (pub.phase) {
    case 'lobby':
      return <Said words={lobbyWords(onStage, pub.rules)} />
    case 'showing':
      return <Showing pub={pub} serverNow={serverNow} />
    case 'wall':
      return <Wall pub={pub} view={view} player={player} players={players} myAnswers={myAnswers} onStage={onStage} mediaUrl={mediaUrl} />
    case 'asking':
      return current && pub.current ? (
        <Asking
          key={pub.current.key}
          picture={current}
          endsAt={pub.current.endsAt}
          prompt={prompts.find((p) => p.key === pub.current!.key)}
          saved={myAnswers[pub.current.key]}
          inPicture={view?.inPicture === true}
          player={player}
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

/** A head, a line under it and the reading text: the lobby's, the showing's, the wall's. */
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

/** The showing: look at the TV, and which picture is on, by the database clock. */
function Showing({ pub, serverNow }: { pub: FusionPublicState; serverNow: () => number }) {
  const now = useServerTime(serverNow, 500)
  const index = showingIndex(pub, now)
  return <Said words={showingWords(index === null ? null : (pub.pictures[index]?.label ?? null))} />
}

/** The wall, between pictures: what comes next, your place, and your guesses so far, newest first. */
function Wall({
  pub,
  view,
  player,
  players,
  myAnswers,
  onStage,
  mediaUrl,
}: {
  pub: FusionPublicState
  view: FusionPlayerView | null
  player: Player
  players: Player[]
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
              const outcome = outcomeFor(picture, player.id, view, choiceOf(myAnswers[picture.key]))
              const points = outcomePoints(outcome, pub.rules)
              const who = picture.revealed.people.map((id, i) => (id === player.id ? 'You' : nameOf(players, id, picture.revealed.names[i])))
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
 * A picture being guessed. A voter picks two guests and locks in: the lock
 * shows at once (Sending), then locked in; a refusal brings the picker back
 * with the picks and the server's words. The two in the picture pick and lock
 * in the same way, but their lock never leaves the phone: nothing they send
 * could count, and the TV's count already leaves them out.
 */
function Asking({
  picture,
  endsAt,
  prompt,
  saved,
  inPicture,
  player,
  players,
  onStage,
  submit,
  serverNow,
  mediaUrl,
}: {
  picture: FusionPublicPicture
  endsAt: number
  prompt: PromptState | undefined
  saved: AnswerPayload | undefined
  inPicture: boolean
  player: Player
  players: Player[]
  onStage: boolean
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  serverNow: () => number
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  const [pick, setPick] = useState<PlayerId[]>([])
  const [lock, setLock] = useState<LockState>(NO_LOCK)
  const names = useMemo(() => shortNames(players), [players])
  const lockedIn = isLockedIn(saved, lock)
  const sending = lock.kind === 'sending'
  const now = useServerTime(serverNow, 250, !lockedIn)
  // Time's up by the database clock, a closed prompt, or the database saying so.
  const over = now >= endsAt || (prompt?.closed_at ?? null) !== null || (lock.kind === 'refused' && lock.closed)
  const view = askingCase({ lockedIn, sending, over })
  // A second tap before the first one's render can't send twice.
  const inFlight = useRef(false)
  const nameFor = (id: PlayerId) => names.get(id) ?? nameOf(players, id)

  const header = <AskHeader picture={picture} endsAt={endsAt} closed={over} serverNow={serverNow} mediaUrl={mediaUrl} />

  if (view === 'locked') {
    // Locked in means a lock to show: this tap's, or the one read back.
    const two = lockedPick(saved, lock)!
    const twoNames = two.map(nameFor)
    const words = lockedWords(twoNames, onStage)
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <MomentCard head={words.head} line={words.line}>
          <TwoTokens people={two} players={players} names={twoNames} />
        </MomentCard>
      </div>
    )
  }
  if (view === 'timeUp') {
    const words = timeUpWords(lock.kind === 'refused' && lock.closed ? lock.message : null, inPicture)
    return (
      <div className="grid grid-cols-1 gap-5">
        {header}
        <MomentCard head={words.head} line={words.line} />
      </div>
    )
  }

  // A guest removed from the party since they were picked can't be locked in on: they drop out of the picks.
  const picks = pick.filter((id) => players.some((p) => p.id === id))
  const shown = sending ? lock.pick : picks
  const shownNames = shown.map(nameFor)
  const canRetry = lock.kind !== 'refused' || lock.retry
  const canLock = picks.length === 2 && !sending && !over && canRetry

  function lockIn() {
    if (!canLock || inFlight.current) return
    // In the picture: locked in on this phone only, the same card as everyone's.
    if (inPicture) return setLock({ kind: 'locked', pick: [picks[0], picks[1]] })
    inFlight.current = true
    void sendLock(picture.key, [picks[0], picks[1]], submit, setLock).finally(() => {
      inFlight.current = false
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {header}
      {/* Two lines kept for it, so the guests stay put as it changes. */}
      <p role="status" className="min-h-[2lh] text-[1.0625rem] leading-snug text-paper-2">
        {pickLine(shownNames, lock, inPicture)}
      </p>
      <GuestPicker
        players={players}
        meId={player.id}
        names={names}
        pick={shown}
        busy={sending || !canRetry}
        onToggle={(id) => {
          setPick((current) => togglePick(current.filter((p) => players.some((player) => player.id === p)), id))
          // A new pick after a refusal starts afresh.
          if (lock.kind === 'refused') setLock(NO_LOCK)
        }}
      />
      <LockBar pick={shown} players={players} names={shownNames} sending={sending} canLock={canLock} onLock={lockIn} />
    </div>
  )
}

/** The reveal on your phone: what you got and your points, who it was, your two picks, and your place. */
function Revealed({
  game,
  pub,
  picture,
  revealedAt,
  view,
  mine,
  player,
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
  players: Player[]
  serverNow: () => number
  mediaUrl: PlayerViewProps['mediaUrl']
}) {
  const id = useId()
  const outcome = outcomeFor(picture, player.id, view, mine)
  const points = outcomePoints(outcome, pub.rules)
  const people = picture.revealed.people
  // When the reveal reached this phone: its sound follows 2 s later, only while fresh.
  const [arrived] = useState(serverNow)
  const fresh = revealedAt !== null && arrived - revealedAt < FRESH_MS
  const moment = fresh && outcome !== 'you' ? `hurra:fusion:${game.id}:${game.started_at ?? 0}:${picture.key}:result` : null
  useMomentSoundAt(moment, points > 0 ? 'coin' : 'sad', arrived + SOUND_AFTER_MS, serverNow)

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-1.5 duration-300 animate-in fade-in-0 motion-reduce:animate-none">
        <p className="text-phone-head leading-tight font-extrabold">{outcomeHead(outcome)}</p>
        {points > 0 && (
          <p className="flex items-baseline gap-2 text-[1.0625rem] font-semibold text-paper-2">
            <span className="text-[1.875rem] leading-none text-paper tv-num">{`+${points}`}</span>
            {points === 1 ? 'point' : 'points'}
          </p>
        )}
        {/* For the two in it: how well the disguise held. */}
        {outcome === 'you' && <p className="text-[1.0625rem] leading-snug text-paper-2">{countsLine(picture.revealed)}</p>}
      </div>

      <div className="flex items-center gap-4 rounded-phone bg-raised p-3">
        <PictureArt picture={picture} mediaUrl={mediaUrl} size="thumb" className="size-20 shrink-0 rounded-tile" labelClassName="text-2xl" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2">
          <p className="flex items-center gap-2">
            <LabelChip label={picture.label} className="shrink-0 text-[1.0625rem]" />
            <span className="font-semibold text-paper-2">It was</span>
          </p>
          <Pair stacked people={people} kept={picture.revealed.names} players={players} meId={player.id} className="text-[1.0625rem]" avatarClassName="size-10" />
        </div>
      </div>

      {mine && outcome !== 'you' && (
        <section aria-labelledby={id} className="grid grid-cols-1 gap-2">
          <h3 id={id} className="text-sm font-bold text-paper-2">
            Your guess
          </h3>
          <ul className="grid grid-cols-1 gap-2">
            {mine.map((id) => {
              const right = people.includes(id)
              const name = nameOf(players, id)
              return (
                <li key={id} className={cn('flex min-h-14 items-center gap-3 rounded-phone py-2 pr-4 pl-2', right ? 'bg-paper text-ink' : 'bg-overlay')}>
                  <Avatar name={name} playerId={id} className="size-10 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-bold">{name}</span>
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
