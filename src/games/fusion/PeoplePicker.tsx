import { CheckIcon, LockKeyIcon, MagnifyingGlassIcon, UserIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlayerId } from '@/games/core/Game'
import type { FusionPublicPicture } from '@/games/fusion/logic'
import { Pair, PictureArt } from '@/games/fusion/parts'
import { candidatesFor, nameOf, pickSignature, togglePick } from '@/games/fusion/view'
import { toast } from '@/lib/toast'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One picture, full screen. While it takes votes: search, an avatar grid of
 * everyone but you, pick two, Save. Once voting is closed: your vote, and the
 * right people after the reveal.
 */
export default function PeoplePicker({
  picture,
  players,
  me,
  vote,
  canVote,
  outcome,
  mediaUrl,
  onSave,
  onClose,
}: {
  picture: FusionPublicPicture
  players: Player[]
  me: Player
  /** This phone's vote on the picture, or null. */
  vote: readonly [PlayerId, PlayerId] | null
  canVote: boolean
  /** What the reveal meant for this player, once it is revealed. */
  outcome: string | null
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  /** Sends the vote; rejects with the database's words. */
  onSave: (pick: [PlayerId, PlayerId]) => Promise<void>
  onClose: () => void
}) {
  const [pick, setPick] = useState<PlayerId[]>(() => (vote ? [...vote] : []))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const candidates = candidatesFor(players, me.id, query)
  const unchanged = pickSignature(pick) === pickSignature(vote)

  async function save() {
    if (pick.length !== 2) return
    setSaving(true)
    try {
      await onSave([pick[0], pick[1]])
      onClose()
    } catch (error) {
      toast.error((error as Error).message)
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Who is in ${picture.label}?`}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="mx-auto flex w-full max-w-md items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3">
        <Button variant="ghost" size="icon-lg" aria-label="Close" onClick={onClose} disabled={saving}>
          <XIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-widest text-paper-2 uppercase">Who is fused?</p>
          <h2 className="truncate text-2xl font-bold">{picture.label}</h2>
        </div>
        <PictureArt
          picture={picture}
          mediaUrl={mediaUrl}
          size="thumb"
          className="size-16 shrink-0 rounded-xl"
          numberClassName="text-3xl"
        />
      </header>

      {canVote ? (
        <>
          <div className="mx-auto w-full max-w-md px-4">
            <p className="mb-3 text-muted-foreground">Pick the 2 guests fused in this picture.</p>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name"
                aria-label="Search guests by name"
                enterKeyHint="search"
                className="h-11 pl-9"
              />
            </div>
          </div>

          <ul className="mx-auto grid w-full max-w-md flex-1 grid-cols-3 content-start gap-2 overflow-y-auto overscroll-contain px-4 py-3">
            {candidates.map((p) => {
              const order = pick.indexOf(p.id)
              const picked = order !== -1
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={picked}
                    disabled={saving}
                    onClick={() => setPick((current) => togglePick(current, p.id))}
                    className={cn(
                      // A pick turns paper, as a quiz answer does: no wash, no ring.
                      'flex w-full flex-col items-center gap-1.5 rounded-phone px-1.5 py-2.5 transition-colors disabled:opacity-60',
                      picked ? 'bg-paper text-ink' : 'bg-raised',
                    )}
                  >
                    <span className="relative">
                      <Avatar name={p.name} className="size-12" />
                      {picked && (
                        <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-chip bg-ink text-[0.65rem] font-black text-paper">
                          {order + 1}
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-center text-sm font-medium">{p.name}</span>
                  </button>
                </li>
              )
            })}
            {candidates.length === 0 && (
              <li className="col-span-3 py-8 text-center text-muted-foreground">
                {query ? `Nobody called “${query}”` : 'Nobody else has joined yet'}
              </li>
            )}
          </ul>

          <footer className="bg-raised px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            <div className="mx-auto flex max-w-md items-center gap-3">
              <span className="flex shrink-0 -space-x-2" aria-hidden>
                {[0, 1].map((slot) =>
                  pick[slot] ? (
                    <Avatar key={pick[slot]} name={nameOf(players, pick[slot])} className="size-10 ring-2 ring-background" />
                  ) : (
                    <span
                      key={`empty-${slot}`}
                      className="grid size-10 place-items-center rounded-token border-2 border-dashed border-foreground/25 bg-background text-muted-foreground"
                    >
                      <UserIcon />
                    </span>
                  ),
                )}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm">
                {pick.length === 0
                  ? 'Pick 2 people'
                  : pick.length === 1
                    ? `${nameOf(players, pick[0])} and one more`
                    : pick.map((id) => nameOf(players, id)).join(' and ')}
              </p>
              <Button size="xl" isPending={saving} disabled={pick.length !== 2 || unchanged} onClick={() => void save()}>
                {vote ? 'Change' : 'Save'}
              </Button>
            </div>
          </footer>
        </>
      ) : (
        <div className="mx-auto grid w-full max-w-md content-start gap-5 overflow-y-auto px-4 pb-8">
          <PictureArt
            picture={picture}
            mediaUrl={mediaUrl}
            size="thumb"
            className="aspect-square w-full rounded-tile"
            numberClassName="text-8xl"
          />
          {picture.revealed && (
            <section className="space-y-2 rounded-phone bg-raised p-4">
              <p className="text-xs font-semibold tracking-widest text-paper-2 uppercase">It was</p>
              <Pair
                people={picture.revealed.people}
                kept={picture.revealed.names}
                players={players}
                meId={me.id}
                className="text-lg"
                avatarClassName="size-10"
              />
              {outcome && <p className="text-sm text-muted-foreground">{outcome}</p>}
            </section>
          )}
          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              <LockKeyIcon /> Your vote
            </p>
            {vote ? (
              <ul className="grid gap-2">
                {vote.map((id) => {
                  const right = picture.revealed?.people.includes(id)
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-phone bg-raised px-3 py-2">
                      <Avatar name={nameOf(players, id)} className="size-8" />
                      <span className="min-w-0 flex-1 truncate font-medium">{nameOf(players, id)}</span>
                      {picture.revealed &&
                        (right ? (
                          <CheckIcon weight="bold" className="size-5 text-paper" aria-label="Right" />
                        ) : (
                          <XIcon weight="bold" className="size-5 text-destructive" aria-label="Wrong" />
                        ))}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground">You didn't vote on this one.</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
