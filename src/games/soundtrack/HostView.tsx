import {
  ClockClockwiseIcon,
  CrownIcon,
  DotsThreeIcon,
  ImageIcon,
  ListNumbersIcon,
  LockKeyIcon,
  MegaphoneSimpleIcon,
  PlayIcon,
  SparkleIcon,
  TelevisionSimpleIcon,
  UserMinusIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import Confirm from '@/components/Confirm'
import { clockTime } from '@/components/tv/clock'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { PlayerId } from '@/games/core/Game'
import { cueOf, titleLine } from '@/games/soundtrack/host/cue'
import CueCard from '@/games/soundtrack/host/CueCard'
import CueList from '@/games/soundtrack/host/CueList'
import { cueListRows } from '@/games/soundtrack/host/cueRows'
import { InPhotoDialog, SitOutDialog } from '@/games/soundtrack/host/PeopleDialogs'
import { acceptId, closeLeft, songReview } from '@/games/soundtrack/host/review'
import ReviewPanel from '@/games/soundtrack/host/ReviewPanel'
import { menuSteps, moreTime, nextStep, type Step, type StepIcon, type Where } from '@/games/soundtrack/host/steps'
import type { SoundtrackGame } from '@/games/soundtrack/logic'
import { readPublic } from '@/games/soundtrack/read'
import type { SoundtrackConfig, SoundtrackHostAction, SoundtrackPhase, SoundtrackPublicState } from '@/games/soundtrack/types'
import type { HostViewProps } from '@/games/types'
import type { Player } from '@/lib/types'

const ICONS: Record<StepIcon, Icon> = {
  play: PlayIcon,
  lastCall: MegaphoneSimpleIcon,
  more: ClockClockwiseIcon,
  lock: LockKeyIcon,
  reveal: SparkleIcon,
  top: ListNumbersIcon,
  crown: CrownIcon,
}

/** The phase as a word on the overlay chip: gold is the next step's. */
const PHASE_WORD: Record<SoundtrackPhase, string> = {
  lobby: 'Ready',
  playing: 'Songs playing',
  lastCall: 'Last call',
  locked: 'Locked',
  reveal: 'Revealing',
  standings: 'Top 5',
  done: 'Over',
}

/**
 * Lydspor in the host control room (spec section 10, mockup 06): the cue card
 * for Spotify, one gold button for the next step (Play song n, Last call,
 * Reveal song n, Show the top 5, Crown Lydspor), the steps that skip ahead in
 * the menu beside it behind a confirmation, and at each reveal the close
 * answers to accept while the story is told. Who sits out and who is in each
 * photo open from the menu, out of sight, and pick from the whole guest list. Every action names its step, and
 * each button stays busy until the game has moved, so a double tap is a skip.
 */
export default function HostView({
  session,
  game,
  players,
  guests,
  publicState,
  state,
  config,
  tallies,
  serverNow,
  mediaUrl,
  act,
}: HostViewProps<SoundtrackGame>) {
  // A step in flight, then settling until the state it was sent from is replaced, so the button never flashes back.
  const [inFlight, setInFlight] = useState<string | null>(null)
  const [settling, setSettling] = useState<{ id: string; from: unknown } | null>(null)
  const [confirming, setConfirming] = useState<Step | null>(null)
  const [dialog, setDialog] = useState<'sitOut' | 'inPhoto' | null>(null)
  // An older song's review, opened from the cue list until the next reveal.
  const [picked, setPicked] = useState<{ index: number; at: number } | null>(null)
  const pub = readPublic(publicState)

  if (state === undefined) return <p className="text-paper-2">Loading Lydspor…</p>
  if (!state || !pub) return <p className="text-paper-2">Hanging the photos…</p>

  const settings: SoundtrackConfig | null = config && Array.isArray(config.songs) ? config : null
  const pending = inFlight ?? (settling && settling.from === state ? settling.id : null)
  const busy = pending !== null
  const where: Where = {
    phase: pub.phase,
    played: pub.playedAt.length,
    total: pub.total,
    revealed: pub.revealed,
    standingsEvery: settings?.standingsEvery ?? 4,
    lastCallSeconds: settings?.lastCallSeconds ?? 60,
    extended: typeof state.extended === 'number' ? state.extended : 0,
    closing: typeof state.closingAt === 'number',
  }
  const main = nextStep(where)
  const more = moreTime(where)
  const menu = menuSteps(where)
  const over = pub.phase === 'done'
  const onTv = session.spotlight_game_id === game.id
  const cue = cueOf({
    where,
    config: settings,
    playedAt: pub.playedAt,
    lockedAt: pub.lockedAt,
    tallies,
    playing: pub.playing,
    title: game.title,
    clock: clockTime,
  })
  const reviewOf = (index: number) => songReview(state, settings, players, index)
  const latest = pub.revealed - 1
  const shownIndex = picked && picked.at === pub.revealed && picked.index < pub.revealed ? picked.index : latest
  const review = shownIndex >= 0 && (pub.phase === 'reveal' || pub.phase === 'standings' || over) ? reviewOf(shownIndex) : null

  async function send(id: string, action: SoundtrackHostAction, close?: string[]) {
    if (busy) return
    const from = state
    setInFlight(id)
    try {
      await act(action, close && close.length > 0 ? { close } : undefined)
      setSettling({ id, from })
      // In case the state never changes (a skip the snapshot already had): give the buttons back.
      setTimeout(() => setSettling((current) => (current?.id === id && current.from === from ? null : current)), 4000)
    } catch {
      // The host page shows the refusal in the server's words.
    } finally {
      setInFlight(null)
    }
  }
  const run = (step: Step) => void send(step.id, step.action, step.close)
  const choose = (step: Step) => (step.confirm ? setConfirming(step) : run(step))

  return (
    // grid-cols-1: one column as wide as the panel, so long texts wrap instead of widening it.
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge size="lg" variant="secondary">
          {PHASE_WORD[pub.phase]}
        </Badge>
        <p className="text-lg font-extrabold">{stageLine(pub)}</p>
      </div>

      {!onTv && !over && (
        <p className="flex items-start gap-2 text-sm font-bold text-paper">
          <TelevisionSimpleIcon weight="fill" className="mt-0.5 shrink-0" />
          {game.title} plays on the TV: show it on the TV before the next step.
        </p>
      )}

      <CueCard cue={cue} lockAt={pub.phase === 'lastCall' ? pub.lockAt : null} serverNow={serverNow} titleLine={settings ? titleLine(where, settings.songs) : null} />

      {!over && (
        <div className="flex items-center gap-2">
          {main && (
            <Button
              size="lg"
              className="h-12 min-w-0 flex-1 text-base sm:h-11 sm:flex-none sm:px-6"
              disabled={busy}
              isPending={pending === main.id}
              onClick={() => choose(main)}
            >
              <StepGlyph icon={main.icon} />
              {main.label}
            </Button>
          )}
          {more && (
            <Button
              variant="secondary"
              size="lg"
              className="h-12 min-w-0 flex-1 text-base sm:h-11 sm:flex-none sm:px-5"
              disabled={busy}
              isPending={pending === more.id}
              onClick={() => run(more)}
            >
              <StepGlyph icon={more.icon} />
              {more.label}
              <span className="font-medium text-paper-2">{more.left} left</span>
            </Button>
          )}
          {/* Not modal, so the dialogs it opens don't fight it for focus. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon-lg" className="size-12 sm:size-11" disabled={busy} aria-label="More Lydspor steps">
                <DotsThreeIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-60">
              {menu.map((step) => (
                <DropdownMenuItem key={step.id} onSelect={() => choose(step)}>
                  <StepGlyph icon={step.icon} />
                  {step.label}
                </DropdownMenuItem>
              ))}
              {menu.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setDialog('sitOut')}>
                <UserMinusIcon />
                Who sits out…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!settings} onSelect={() => setDialog('inPhoto')}>
                <ImageIcon />
                Who's in each photo…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {(pub.phase === 'standings' || (over && pub.final)) && <TopFive pub={pub} players={players} title={game.title} />}

      {review && (
        <ReviewPanel
          // A new song's review starts with its folds closed.
          key={review.index}
          review={review}
          latest={shownIndex !== latest ? latest + 1 : null}
          onShowLatest={() => setPicked(null)}
          open={!over}
          pending={pending}
          onAccept={(part, row, accepted) =>
            void send(acceptId(review.index, part, row.key), { type: 'accept', index: review.index, part, key: row.key, accepted })
          }
        />
      )}

      <CueList
        rows={cueListRows(settings, pub.total, pub.phase, pub.playedAt, pub.revealed, (i) => closeLeft(reviewOf(i)))}
        clock={clockTime}
        onOpenReview={(index) => {
          setPicked({ index, at: pub.revealed })
          // The review stands above the list: bring it into view once it shows that song.
          requestAnimationFrame(() => document.getElementById(`review-${index + 1}`)?.scrollIntoView({ block: 'start' }))
        }}
      />

      <Confirm
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.confirm?.title ?? ''}
        description={confirming?.confirm?.description}
        confirmLabel={confirming?.confirm?.label ?? 'Go ahead'}
        cancelLabel="Not yet"
        variant="default"
        onConfirm={() => {
          if (confirming) run(confirming)
          setConfirming(null)
        }}
      />
      <SitOutDialog
        open={dialog === 'sitOut'}
        onOpenChange={(open) => setDialog(open ? 'sitOut' : null)}
        guests={guests}
        current={Array.isArray(state.sitOut) ? state.sitOut : []}
        onSave={(playerIds: PlayerId[]) => act({ type: 'sitOut', playerIds })}
      />
      {settings && (
        <InPhotoDialog
          open={dialog === 'inPhoto'}
          onOpenChange={(open) => setDialog(open ? 'inPhoto' : null)}
          guests={guests}
          songs={settings.songs}
          current={Array.isArray(state.inPhoto) ? state.inPhoto : []}
          mediaUrl={mediaUrl}
          onSave={(index, playerIds) => act({ type: 'setInPhoto', index, playerIds })}
        />
      )}
    </div>
  )
}

function StepGlyph({ icon }: { icon: StepIcon }) {
  const Glyph = ICONS[icon]
  return <Glyph weight={icon === 'reveal' ? 'fill' : 'bold'} />
}

/** Where Lydspor is, as the phones' strap says it: "Song 5 of 8", "Reveal 1 of 8". */
function stageLine(pub: SoundtrackPublicState): string {
  const played = pub.playedAt.length
  switch (pub.phase) {
    case 'lobby':
      return `${pub.total} ${pub.total === 1 ? 'song' : 'songs'}, none played yet`
    case 'playing':
      return `Song ${played} of ${pub.total}`
    case 'lastCall':
      return `${played} ${played === 1 ? 'song' : 'songs'} played`
    case 'locked':
      return `${played} ${played === 1 ? 'song' : 'songs'}, none revealed yet`
    case 'reveal':
    case 'standings':
      return `Reveal ${pub.revealed} of ${played}`
    case 'done':
      return 'Lydspor is over'
  }
}

/** Lydspor's top 5 as the TV shows it, with each gain since the last top 5; after the crown, the final places. */
function TopFive({ pub, players, title }: { pub: SoundtrackPublicState; players: readonly Player[]; title: string }) {
  const nameOf = (id: PlayerId) => players.find((p) => p.id === id)?.name ?? 'A guest'
  const rows = pub.final
    ? pub.final.slice(0, 5).map((row) => ({ playerId: row.playerId, rank: row.place, points: row.points, credit: 0, gained: 0 }))
    : pub.top
  return (
    <section>
      <h3 className="mb-2 text-sm font-extrabold">{pub.final ? `${title}’s final places` : `${title}’s top 5 on the TV`}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-paper-2">Nobody has scored yet.</p>
      ) : (
        <ol className="divide-y divide-rule">
          {rows.map((row) => (
            <li key={row.playerId} className="flex items-center gap-3 py-1.5">
              <span className="tv-num w-5 text-right text-base text-paper-3">{row.rank}</span>
              <Avatar name={nameOf(row.playerId)} playerId={row.playerId} className="size-7" />
              <span className="min-w-0 flex-1 truncate font-bold">{nameOf(row.playerId)}</span>
              {/* The gain since the last top 5; at the first one it would only repeat the points. */}
              {row.gained > 0 && row.gained !== row.points - row.credit && <span className="tv-num text-base text-paper-2">+{row.gained}</span>}
              {row.credit > 0 && <span className="text-sm font-semibold whitespace-nowrap text-paper-2">+{row.credit} own photo</span>}
              <span className="tv-num min-w-8 text-right text-lg text-paper">{row.points}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
