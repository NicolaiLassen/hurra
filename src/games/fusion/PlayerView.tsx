import { CheckIcon, DetectiveIcon, LockKeyIcon, TrophyIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type { PlayerId } from '@/games/core/Game'
import { plural, type FusionGame, type FusionPublicPicture } from '@/games/fusion/logic'
import PeoplePicker from '@/games/fusion/PeoplePicker'
import { Pair, PictureArt } from '@/games/fusion/parts'
import { choiceOf, firstTime, outcomeOf, pickSignature, publicOf, revealPoints, takesVotes } from '@/games/fusion/view'
import type { PlayerViewProps } from '@/games/types'
import { playSoftSound } from '@/lib/sound'
import { cn } from '@/lib/utils'

/** A vote this phone saved, shown until the snapshot catches up: `over` is what the snapshot said when it was saved. */
type Saved = { choice: [PlayerId, PlayerId]; over: string }

/** How long after a reveal a phone still plays its coin (one that opens the game later stays quiet). */
const FRESH_REVEAL_MS = 30_000

/** The phone: every picture with your vote, a people picker per picture, and the reveals as they happen. */
export default function PlayerView({
  game,
  player,
  players,
  publicState,
  view,
  myAnswers,
  prompts,
  submit,
  serverNow,
  mediaUrl,
}: PlayerViewProps<FusionGame>) {
  const pub = publicOf(publicState)
  const [openN, setOpenN] = useState<number | null>(null)
  const [saved, setSaved] = useState<Record<string, Saved>>({})
  const close = useCallback(() => setOpenN(null), [])

  // Your coin for a picture you got right, once per reveal, after the reveal's own sting.
  const lastN = pub?.lastReveal?.n
  const lastAt = pub?.lastReveal?.at
  const lastPoints = lastN === undefined ? 0 : revealPoints(view?.hits[lastN], pub?.scoring)
  useEffect(() => {
    if (lastN === undefined || lastAt === undefined || lastPoints <= 0) return
    if (serverNow() - lastAt > FRESH_REVEAL_MS) return
    if (firstTime(`fusion:${game.id}:${game.started_at}:reveal:${lastN}`)) playSoftSound('coin', 2000)
  }, [lastN, lastAt, lastPoints, game.id, game.started_at, serverNow])

  if (!pub) return <p className="py-8 text-center text-muted-foreground">Hanging the pictures…</p>

  /** This phone's vote: the one it just saved until the snapshot moves on, else the snapshot's. */
  const voteOf = (key: string) => {
    const mine = saved[key]
    const snapshot = choiceOf(myAnswers[key])
    return mine && pickSignature(snapshot) === mine.over ? mine.choice : snapshot
  }

  async function save(picture: FusionPublicPicture, pick: [PlayerId, PlayerId]) {
    const over = pickSignature(choiceOf(myAnswers[picture.key]))
    const result = await submit(picture.key, { choice: pick })
    const choice = choiceOf(result.answer) ?? pick
    setSaved((current) => ({ ...current, [picture.key]: { choice, over } }))
  }

  const total = pub.pictures.length
  const voted = pub.pictures.filter((p) => voteOf(p.key)).length
  const revealed = pub.pictures.filter((p) => p.revealed).length
  const points = view?.points ?? 0
  const outcome = (picture: FusionPublicPicture) => outcomeOf(picture, player.id, view?.hits[picture.n], pub.scoring)
  const opened = openN === null ? undefined : pub.pictures.find((p) => p.n === openN)

  return (
    <div className="space-y-5">
      {pub.phase === 'voting' ? (
        <section className="space-y-3 rounded-2xl bg-confetti-violet/10 p-4 ring-1 ring-confetti-violet/30">
          <div className="flex items-start gap-3">
            <DetectiveIcon weight="duotone" className="size-8 shrink-0 text-confetti-violet" />
            <div className="min-w-0">
              <p className="font-bold">{voted === total ? 'All voted!' : 'Who is fused in each picture?'}</p>
              <p className="text-sm text-muted-foreground">
                {voted === total
                  ? 'You can still change a vote until the host locks voting.'
                  : 'Find the prints on the wall, then tap a picture here and pick the two guests in it.'}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold tabular-nums">
              {voted} of {total} voted
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-confetti-violet transition-[width] duration-500"
                style={{ width: `${total ? (voted / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="flex items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
          {pub.phase === 'locked' ? (
            <LockKeyIcon weight="duotone" className="size-8 shrink-0 text-confetti-violet" />
          ) : (
            <TrophyIcon weight="duotone" className="size-8 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <p className="font-bold">{pub.phase === 'locked' ? 'Voting is closed. Watch the TV.' : 'That was the reveal!'}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {pub.phase === 'locked' ? `${revealed} of ${total} revealed. ` : ''}
              You have {plural(points, 'point')}.
            </p>
          </div>
        </section>
      )}

      <ul className="grid grid-cols-2 gap-3">
        {pub.pictures.map((picture) => {
          const vote = voteOf(picture.key)
          const open = takesVotes(pub.phase, picture, prompts)
          return (
            <li key={picture.n}>
              <PictureCard
                picture={picture}
                vote={vote}
                open={open}
                latest={picture.n === lastN && picture.revealed !== null}
                outcome={picture.revealed ? outcome(picture) : null}
                gotPoints={revealPoints(view?.hits[picture.n], pub.scoring) > 0}
                players={players}
                meId={player.id}
                mediaUrl={mediaUrl}
                onOpen={() => setOpenN(picture.n)}
              />
            </li>
          )
        })}
      </ul>

      {pub.scoring && (
        <p className="text-center text-xs text-muted-foreground">
          {plural(pub.scoring.perPerson, 'point')} for each right person
          {pub.scoring.bothBonus > 0 ? `, plus ${pub.scoring.bothBonus} for getting both` : ''}. Nobody scores on a
          picture they're in.
        </p>
      )}

      {opened && (
        <PeoplePicker
          key={opened.n}
          picture={opened}
          players={players}
          me={player}
          vote={voteOf(opened.key)}
          canVote={takesVotes(pub.phase, opened, prompts)}
          outcome={opened.revealed ? outcome(opened) : null}
          mediaUrl={mediaUrl}
          onSave={(pick) => save(opened, pick)}
          onClose={close}
        />
      )}
    </div>
  )
}

function PictureCard({
  picture,
  vote,
  open,
  latest,
  outcome,
  gotPoints,
  players,
  meId,
  mediaUrl,
  onOpen,
}: {
  picture: FusionPublicPicture
  vote: readonly [PlayerId, PlayerId] | null
  open: boolean
  /** The picture revealed last: it stands out until the next one. */
  latest: boolean
  outcome: string | null
  gotPoints: boolean
  players: PlayerViewProps['players']
  meId: PlayerId
  mediaUrl: PlayerViewProps['mediaUrl']
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full overflow-hidden rounded-2xl bg-card text-left ring-1 ring-foreground/10 transition-shadow',
        latest && 'ring-2 ring-confetti-violet shadow-[0_0_24px_rgb(167_139_250/0.35)]',
      )}
    >
      <div className="relative">
        <PictureArt picture={picture} mediaUrl={mediaUrl} size="thumb" className="aspect-square w-full" />
        {picture.revealed ? (
          <span className="absolute top-2 left-2 rounded-full bg-confetti-violet px-2 py-0.5 text-xs font-bold text-background">
            Revealed
          </span>
        ) : vote ? (
          <span
            className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"
            aria-label="Voted"
          >
            {open ? <CheckIcon weight="bold" /> : <LockKeyIcon weight="bold" />}
          </span>
        ) : null}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate font-bold">{picture.label}</p>
        {picture.revealed ? (
          <>
            <Pair
              stacked
              people={picture.revealed.people}
              kept={picture.revealed.names}
              players={players}
              meId={meId}
              className="text-sm"
              avatarClassName="size-6 text-[0.6rem]"
            />
            <p className={cn('text-xs', gotPoints ? 'font-semibold text-primary' : 'text-muted-foreground')}>{outcome}</p>
          </>
        ) : vote ? (
          <>
            <Pair stacked people={vote} players={players} className="text-sm" avatarClassName="size-6 text-[0.6rem]" />
            <p className="text-xs text-muted-foreground">{open ? 'Tap to change' : 'Locked in'}</p>
          </>
        ) : open ? (
          <p className="text-sm font-semibold text-confetti-violet">Tap to vote</p>
        ) : (
          <p className="text-sm text-muted-foreground">No vote</p>
        )}
      </div>
    </button>
  )
}
