import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CrownIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  GridFourIcon,
  PlayIcon,
  QuestionIcon,
  TelevisionSimpleIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PlayerId } from '@/games/core/Game'
import {
  canAsk,
  headline,
  hostSteps,
  mayVote,
  PHASE_CHIP,
  type HostConfirm,
  type HostStep,
  type StepIcon,
} from '@/games/fusion/host'
import type { FusionGame, FusionState } from '@/games/fusion/logic'
import { Pair, PictureArt } from '@/games/fusion/parts'
import {
  countsLine,
  isLegacyState,
  readPublic,
  type FusionHostAction,
  type FusionPublicPicture,
  type FusionPublicState,
} from '@/games/fusion/shapes'
import { nameOf, pickSignature } from '@/games/fusion/view'
import type { HostViewProps } from '@/games/types'
import { useServerTime } from '@/lib/gameClock'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICONS: Record<StepIcon, Icon> = {
  play: PlayIcon,
  wall: GridFourIcon,
  ask: QuestionIcon,
  reveal: EyeIcon,
  crown: CrownIcon,
}

/**
 * Participant fusion in the control room (docs/engine-v2.md, 8.4): where the
 * round is, one gold button for its next step and the steps that skip ahead
 * in the menu beside it (docs/identity.md, The host room), every picture with
 * its own Ask, and who is in each picture behind Show who, because the host's
 * phone is out in the room. Each step names the step it was made for, so a
 * double tap or a race with a timer does nothing.
 */
export default function HostView({ session, game, players, state, publicState, tallies, serverNow, act, mediaUrl }: HostViewProps<FusionGame>) {
  const [showWho, setShowWho] = useState(false)
  // One host action at a time: its button shows it is busy, the others wait.
  const [pending, setPending] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<HostStep | null>(null)
  const pub = readPublic(publicState)
  const now = useServerTime(serverNow, 500, pub !== null && pub.phase !== 'done')
  if (state === undefined) return <p className="text-paper-2">Loading the pictures…</p>
  if (!pub) return <p className="text-paper-2">Getting the pictures ready…</p>

  const legacy = state !== null && isLegacyState(state)
  const steps = hostSteps(pub, state, tallies, players, now)
  const busy = pending !== null
  const onAir = session.spotlight_game_id === game.id
  const unset = pub.pictures.filter((p) => p.revealed === null && !state?.key?.[p.n]).length

  async function send(id: string, action: FusionHostAction, close?: string[]) {
    setPending(id)
    try {
      await act(action, close ? { close } : undefined)
    } catch {
      // The host page shows the refusal in the server's words.
    } finally {
      setPending(null)
    }
  }

  const take = (step: HostStep) => {
    if (step.confirm) setConfirming(step)
    else void send(stepId(step), step.action, step.close)
  }

  return (
    // grid-cols-1: one column as wide as the panel, so long texts wrap instead of widening it.
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The phase as a word on the overlay: gold is the next step's. */}
        <Badge size="lg" variant="secondary">
          {legacy ? 'Started before the update' : PHASE_CHIP[pub.phase]}
        </Badge>
        <p className="text-lg font-extrabold">{headline(pub, now)}</p>
        {pub.phase === 'asking' && pub.current && <SecondsLeft endsAt={pub.current.endsAt} now={now} />}
        <Button variant="ghost" className="ml-auto" onClick={() => setShowWho((shown) => !shown)}>
          {showWho ? <EyeSlashIcon /> : <EyeIcon />}
          {showWho ? 'Hide who' : 'Show who'}
        </Button>
      </div>

      {legacy ? (
        <Notice icon={ArrowCounterClockwiseIcon}>
          This round started before the update and can't go on. End it, then restart it from the program: its pictures and
          people are kept.
        </Notice>
      ) : (
        pub.phase !== 'done' && (
          <>
            {!onAir && (
              <Notice icon={TelevisionSimpleIcon}>
                Participant fusion isn't on the TV. Show it on the TV first: the pictures play there.
              </Notice>
            )}
            {unset > 0 && (
              <Notice icon={WarningIcon}>
                {unset === 1 ? "1 picture doesn't" : `${unset} pictures don't`} have their two people set yet. Use Show who to
                set them before you ask them.
              </Notice>
            )}
          </>
        )
      )}

      {(steps.main || steps.extra.length > 0) && (
        <div className="flex items-center gap-2">
          {steps.main && (
            <Button
              size="lg"
              className="h-12 flex-1 text-base sm:h-11 sm:flex-none sm:px-6"
              disabled={busy}
              isPending={pending === stepId(steps.main)}
              onClick={() => take(steps.main!)}
            >
              <StepGlyph icon={steps.main.icon} />
              {steps.main.label}
            </Button>
          )}
          {steps.extra.length > 0 && (
            // Not modal, so the dialog it opens doesn't fight it for focus.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon-lg" className="size-12 sm:size-11" disabled={busy} aria-label="More steps for this game">
                  <DotsThreeIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-56">
                {steps.extra.map((step) => (
                  <DropdownMenuItem key={stepId(step)} onSelect={() => take(step)}>
                    <StepGlyph icon={step.icon} />
                    {step.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {pub.phase === 'asking' && pub.current && state && (
        <LockedPips count={tallies[pub.current.key] ?? 0} total={mayVote(state, pub.current.n, players)} />
      )}
      {steps.line && <p className="-mt-2 text-sm text-paper-2">{steps.line}</p>}

      <ConfirmDialog
        confirm={confirming?.confirm ?? null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void send(stepId(confirming), confirming.action, confirming.close)
          setConfirming(null)
        }}
      />

      <ul className="divide-y divide-rule">
        {pub.pictures.map((picture) => (
          <PictureRow
            key={picture.n}
            picture={picture}
            pub={pub}
            state={state}
            players={players}
            showWho={showWho}
            legacy={legacy}
            busy={busy}
            pending={pending}
            mediaUrl={mediaUrl}
            onSetKey={(people) => void send(`key:${picture.n}`, { type: 'setKey', n: picture.n, people })}
            onAsk={() => void send(`ask:${picture.n}`, { type: 'ask', n: picture.n })}
          />
        ))}
      </ul>

      {pub.top.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-extrabold">{pub.phase === 'done' ? 'Sharpest eyes' : 'Sharpest eyes so far'}</h3>
          <ol className="divide-y divide-rule">
            {pub.top.map((row) => (
              <li key={row.playerId} className="flex items-center gap-3 py-1.5">
                <span className="tv-num w-5 text-right text-base text-paper-3">{row.rank}</span>
                <Avatar name={nameOf(players, row.playerId)} playerId={row.playerId} className="size-7" />
                <span className="min-w-0 flex-1 truncate font-bold">{nameOf(players, row.playerId)}</span>
                <span className="tv-num text-lg text-paper">{row.points}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

/** A step's id for its pending state: the action it sends. */
function stepId(step: HostStep): string {
  const action = step.action as { type: string; n?: number; from?: string }
  return [action.type, action.from, action.n].filter((part) => part !== undefined).join(':')
}

function StepGlyph({ icon }: { icon: StepIcon }) {
  const Glyph = ICONS[icon]
  return <Glyph />
}

/** A note in the card: a solid panel with its icon, never a glass callout (docs/identity.md). */
function Notice({ icon: Glyph, children }: { icon: Icon; children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 rounded-lg bg-overlay p-3 text-sm font-semibold text-paper">
      <Glyph weight="fill" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** The time left on the picture asked, its number in condensed numerals: "9 s left", then "Time's up". Paper, never gold. */
function SecondsLeft({ endsAt, now }: { endsAt: number; now: number }) {
  const left = endsAt - now
  if (left <= 0) return <span className="text-lg font-bold text-paper-2">Time's up</span>
  return (
    <span className="text-lg font-bold text-paper">
      <span className="tv-num text-xl">{Math.ceil(left / 1000)}</span> s left
    </span>
  )
}

/**
 * How many have locked in: a square pip per guest who may, filled in paper as
 * locks come in; the line under the steps says the count. Exact here (the
 * host's own count), and counts only: never who.
 */
function LockedPips({ count, total }: { count: number; total: number }) {
  const pips = Math.max(total, count)
  return (
    <div className="flex flex-wrap gap-1" role="img" aria-label={`${count} of ${pips} have locked in`}>
      {Array.from({ length: pips }, (_, i) => (
        <span
          key={i}
          className={cn('size-2.5 rounded-[2px] transition-colors duration-500', i < count ? 'bg-paper' : 'border-[1.5px] border-rule')}
        />
      ))}
    </div>
  )
}

/** One picture: its thumbnail and label, where it stands, how the room did, its people behind Show who, and its own Ask. */
function PictureRow({
  picture,
  pub,
  state,
  players,
  showWho,
  legacy,
  busy,
  pending,
  mediaUrl,
  onSetKey,
  onAsk,
}: {
  picture: FusionPublicPicture
  pub: FusionPublicState
  state: FusionState | null
  players: Player[]
  showWho: boolean
  legacy: boolean
  busy: boolean
  pending: string | null
  mediaUrl: HostViewProps['mediaUrl']
  onSetKey: (people: [PlayerId, PlayerId]) => void
  onAsk: () => void
}) {
  const key = state?.key?.[picture.n] ?? null
  const result = picture.revealed
  const onNow = (pub.phase === 'asking' || pub.phase === 'reveal') && pub.current?.n === picture.n
  const askable = !legacy && !result && !onNow && canAsk(pub.phase)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <PictureArt
        picture={picture}
        mediaUrl={mediaUrl}
        size="thumb"
        className="h-15 w-12 shrink-0 rounded-chip bg-overlay"
        labelClassName="text-[13px]"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-bold">{picture.label}</span>
          {onNow ? (
            <Badge variant="secondary">On now</Badge>
          ) : result ? (
            <Badge variant="ghost">Revealed</Badge>
          ) : (
            <Badge variant="outline">Not asked</Badge>
          )}
        </p>
        {result && <p className="text-sm text-paper-2">{countsLine(result)}</p>}
      </div>

      {result ? (
        <Pair people={result.people} kept={result.names} players={players} className="text-sm" />
      ) : showWho && state && !legacy && pub.phase !== 'done' ? (
        <KeyEditor
          // Starts again from the saved key whenever it changes.
          key={pickSignature(key)}
          current={key}
          state={state}
          players={players}
          disabled={busy}
          pending={pending === `key:${picture.n}`}
          onSave={onSetKey}
        />
      ) : showWho && key ? (
        <Pair people={key} kept={key.map((id) => state?.names?.[id] ?? 'A guest')} players={players} className="text-sm" />
      ) : key ? (
        <Badge variant="ghost">
          <CheckIcon />
          People set
        </Badge>
      ) : (
        <Badge variant="outline">
          <WarningIcon />
          Who is it?
        </Badge>
      )}

      {askable && (
        <Button
          variant="secondary"
          disabled={busy || !key}
          isPending={pending === `ask:${picture.n}`}
          onClick={onAsk}
          title={key ? undefined : 'Set who is in it first'}
        >
          <QuestionIcon />
          Ask
        </Button>
      )}
    </li>
  )
}

/** Two pickers for who is in a picture, and Save once both are chosen and differ from what is saved. */
function KeyEditor({
  current,
  state,
  players,
  disabled,
  pending,
  onSave,
}: {
  current: readonly [PlayerId, PlayerId] | null
  state: FusionState
  players: Player[]
  disabled: boolean
  pending: boolean
  onSave: (people: [PlayerId, PlayerId]) => void
}) {
  const [draft, setDraft] = useState<[PlayerId, PlayerId]>(() => (current ? [current[0], current[1]] : ['', '']))
  const same = draft[0] !== '' && draft[0] === draft[1]
  const ready = draft[0] !== '' && draft[1] !== '' && !same && pickSignature(draft) !== pickSignature(current)
  // Someone in the saved key who has left the party still shows, by the name the game kept.
  const gone = (current ?? []).filter((id) => !players.some((p) => p.id === id))
  const options = [
    ...[...players].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name })),
    ...gone.map((id) => ({ id, name: `${state.names?.[id] ?? 'A guest'} (left)` })),
  ]

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {[0, 1].map((slot) => (
        <Select
          key={slot}
          value={draft[slot]}
          disabled={disabled}
          onValueChange={(id) => setDraft((d) => (slot === 0 ? [id, d[1]] : [d[0], id]))}
        >
          <SelectTrigger size="sm" className="w-36" aria-label={slot === 0 ? 'First person' : 'Second person'}>
            <SelectValue placeholder="Pick someone" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id} disabled={gone.includes(option.id)}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {ready && (
        <Button size="sm" variant="secondary" disabled={disabled} isPending={pending} onClick={() => onSave(draft)}>
          Save
        </Button>
      )}
      {same && <p className="w-full text-xs text-paper-2">Pick two different people</p>}
    </div>
  )
}

/** Asks first, for a step that crowns while pictures are left. */
function ConfirmDialog({ confirm, onCancel, onConfirm }: { confirm: HostConfirm | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{confirm?.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <CrownIcon />
            {confirm?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
