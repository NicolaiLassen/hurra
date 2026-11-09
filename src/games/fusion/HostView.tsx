import {
  CheckIcon,
  CrownIcon,
  EyeIcon,
  EyeSlashIcon,
  LockKeyIcon,
  SparkleIcon,
  TelevisionSimpleIcon,
  WarningIcon,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PlayerId } from '@/games/core/Game'
import {
  plural,
  type FusionGame,
  type FusionHostAction,
  type FusionPublicPicture,
  type FusionState,
} from '@/games/fusion/logic'
import { Pair, PictureArt } from '@/games/fusion/parts'
import { nameOf, pickSignature, publicOf, totalVotes } from '@/games/fusion/view'
import type { HostViewProps } from '@/games/types'
import { withRanks } from '@/lib/format'
import type { Player } from '@/lib/types'

/**
 * The control room: Lock voting, Reveal next and Crown, the votes per picture,
 * and who is in each picture behind Show who (the host's phone is out in the
 * room, so the key stays hidden until asked for).
 */
export default function HostView({ session, game, players, state, publicState, tallies, act, mediaUrl }: HostViewProps<FusionGame>) {
  const [showWho, setShowWho] = useState(false)
  // One host action at a time: its button shows it is busy, the others wait.
  const [pending, setPending] = useState<string | null>(null)
  const pub = publicOf(publicState)
  if (state === undefined) return <p className="text-muted-foreground">Loading the pictures…</p>
  if (!state || !pub) return <p className="text-muted-foreground">Hanging the pictures…</p>

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

  const total = pub.pictures.length
  const revealed = pub.pictures.filter((p) => p.revealed).length
  const next = pub.pictures.find((p) => !p.revealed)
  const unset = pub.pictures.filter((p) => !p.revealed && !state.key[p.n]).length
  const busy = pending !== null

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg font-semibold tabular-nums">
          {pub.phase === 'voting'
            ? `${plural(totalVotes(tallies), 'vote')} on ${plural(total, 'picture')}`
            : pub.phase === 'locked'
              ? `Voting closed. ${revealed} of ${total} revealed`
              : 'Done'}
        </p>
        <Button variant="ghost" className="ml-auto" onClick={() => setShowWho((s) => !s)}>
          {showWho ? <EyeSlashIcon /> : <EyeIcon />}
          {showWho ? 'Hide who' : 'Show who'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {pub.phase === 'voting' && (
          <ConfirmButton
            title="Lock voting?"
            description="Guests can't vote or change their votes after this. Then you reveal the pictures one by one on the TV."
            confirm="Lock voting"
            disabled={busy}
            pending={pending === 'lock'}
            onConfirm={() => void send('lock', { type: 'lock' })}
          >
            <LockKeyIcon />
            Lock voting
          </ConfirmButton>
        )}
        {pub.phase === 'locked' && next && (
          <Button
            size="lg"
            disabled={busy || !state.key[next.n]}
            isPending={pending === `reveal:${next.n}`}
            onClick={() => void send(`reveal:${next.n}`, { type: 'reveal', n: next.n }, [next.key])}
          >
            <SparkleIcon />
            Reveal next: {next.label}
          </Button>
        )}
        {pub.phase === 'locked' &&
          (next ? (
            <ConfirmButton
              variant="secondary"
              title="Crown the face detective now?"
              description={`${plural(total - revealed, 'picture')} ${total - revealed === 1 ? "isn't" : "aren't"} revealed yet. They stay secret, and their votes don't count.`}
              confirm="Crown now"
              disabled={busy}
              pending={pending === 'finish'}
              onConfirm={() => void send('finish', { type: 'finish' })}
            >
              <CrownIcon />
              Crown the face detective
            </ConfirmButton>
          ) : (
            <Button size="lg" disabled={busy} isPending={pending === 'finish'} onClick={() => void send('finish', { type: 'finish' })}>
              <CrownIcon />
              Crown the face detective
            </Button>
          ))}
      </div>

      {pub.phase === 'locked' && next && session.spotlight_game_id !== game.id && (
        <p className="flex items-start gap-2 text-sm text-confetti-violet">
          <TelevisionSimpleIcon weight="fill" className="mt-0.5 shrink-0" />
          The reveal plays on the TV: show this game on the TV before you reveal.
        </p>
      )}

      {unset > 0 && pub.phase !== 'done' && (
        <p className="flex items-start gap-2 text-sm text-primary">
          <WarningIcon weight="fill" className="mt-0.5 shrink-0" />
          {unset === 1 ? "1 picture doesn't" : `${unset} pictures don't`} have their two people set yet. Use Show who to
          set them before their reveal.
        </p>
      )}

      <ul className="divide-y">
        {pub.pictures.map((picture) => (
          <PictureRow
            key={picture.n}
            picture={picture}
            state={state}
            players={players}
            votes={tallies[picture.key] ?? 0}
            showWho={showWho}
            busy={busy}
            pending={pending}
            mediaUrl={mediaUrl}
            onSetKey={(people) => void send(`key:${picture.n}`, { type: 'setKey', n: picture.n, people })}
            onReveal={() => void send(`reveal:${picture.n}`, { type: 'reveal', n: picture.n }, [picture.key])}
          />
        ))}
      </ul>

      {pub.top.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {pub.phase === 'done' ? 'Sharpest eyes' : 'Sharpest eyes so far'}
          </h3>
          <ol className="grid gap-1.5">
            {withRanks(pub.top).map((row) => (
              <li key={row.playerId} className="flex items-center gap-2.5">
                <span className="w-5 text-right text-sm font-bold text-muted-foreground tabular-nums">{row.rank}</span>
                <Avatar name={nameOf(players, row.playerId)} className="size-7 text-[0.65rem]" />
                <span className="min-w-0 flex-1 truncate font-medium">{nameOf(players, row.playerId)}</span>
                <span className="font-bold text-primary tabular-nums">{row.points}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function PictureRow({
  picture,
  state,
  players,
  votes,
  showWho,
  busy,
  pending,
  mediaUrl,
  onSetKey,
  onReveal,
}: {
  picture: FusionPublicPicture
  state: FusionState
  players: Player[]
  votes: number
  showWho: boolean
  busy: boolean
  pending: string | null
  mediaUrl: HostViewProps['mediaUrl']
  onSetKey: (people: [PlayerId, PlayerId]) => void
  onReveal: () => void
}) {
  const key = state.key[picture.n] ?? null
  const result = picture.revealed

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <PictureArt picture={picture} mediaUrl={mediaUrl} size="thumb" className="size-12 shrink-0 rounded-lg" numberClassName="text-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{picture.label}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {result
            ? result.voters === 0
              ? 'Nobody voted on it'
              : `${result.both} of ${result.voters} got both, ${result.one} got one`
            : `${votes} of ${players.length} voted`}
        </p>
      </div>

      {result ? (
        <Pair people={result.people} kept={result.names} players={players} className="text-sm" />
      ) : showWho && state.phase !== 'done' ? (
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
        <Pair people={key} kept={key.map((id) => state.names?.[id] ?? 'A guest')} players={players} className="text-sm" />
      ) : key ? (
        <Badge variant="secondary">
          <CheckIcon />
          People set
        </Badge>
      ) : (
        <Badge variant="outline" className="text-primary">
          <WarningIcon />
          Who is it?
        </Badge>
      )}

      {state.phase === 'locked' && !result && (
        <Button
          variant="secondary"
          disabled={busy || !key}
          isPending={pending === `reveal:${picture.n}`}
          onClick={onReveal}
          title={key ? undefined : 'Set who is in it first'}
        >
          Reveal
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
        <Button size="sm" disabled={disabled} isPending={pending} onClick={() => onSave(draft)}>
          Save
        </Button>
      )}
      {same && <p className="w-full text-xs text-destructive">Pick two different people</p>}
    </div>
  )
}

/** A big button that asks first. */
function ConfirmButton({
  title,
  description,
  confirm,
  variant = 'default',
  disabled,
  pending,
  onConfirm,
  children,
}: {
  title: string
  description: string
  confirm: string
  variant?: 'default' | 'secondary'
  disabled: boolean
  pending: boolean
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="lg" variant={variant} disabled={disabled} isPending={pending}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
