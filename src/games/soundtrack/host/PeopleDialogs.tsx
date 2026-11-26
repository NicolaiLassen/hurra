import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { GameGuest } from '@/games/core/Game'
import { sameNames, sitOutNames } from '../people'
import PeopleField from './PeopleField'

/** Someone a name can be suggested from: a guest on the list, or a player. */
type Named = { readonly id: string; readonly name: string }

/**
 * Doesn't play this game: the guests who sit Lydspor out (usually the
 * storyteller and whoever runs Spotify), as typed names with suggestions from
 * the guest list and the guests here. Their phones say so; anything they type
 * scores nothing and isn't counted in the room's numbers.
 */
export function SitOutDialog({
  open,
  onOpenChange,
  guests,
  players,
  current,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guests: readonly GameGuest[]
  players: readonly Named[]
  /** As the game holds it: names (a round started before names may hold ids). */
  current: readonly string[]
  /** Sends the list; resolves once saved, rejects on a refusal (the host page shows it). */
  onSave: (names: string[]) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Mounted only while open, so it starts from the saved list each time. */}
        <SitOutForm guests={guests} players={players} current={current} onSave={onSave} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SitOutForm({
  guests,
  players,
  current,
  onSave,
  onDone,
}: {
  guests: readonly GameGuest[]
  players: readonly Named[]
  current: readonly string[]
  onSave: (names: string[]) => Promise<void>
  onDone: () => void
}) {
  const [draft, setDraft] = useState<string[]>(() => [...current])
  const [saving, setSaving] = useState(false)
  const unchanged = sameNames(sitOutNames(draft, guests, players), sitOutNames(current, guests, players))

  async function save() {
    setSaving(true)
    try {
      await onSave(sitOutNames(draft, guests, players))
      onDone()
    } catch {
      // The host page shows the refusal in the server's words.
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-extrabold">Who sits Lydspor out?</DialogTitle>
        <DialogDescription>
          Usually the storyteller and whoever runs Spotify. Type each name as they join with it. Their phones say they sit this
          one out, and they don't count in the room's numbers.
        </DialogDescription>
      </DialogHeader>
      <PeopleField
        label="Doesn't play Lydspor"
        guests={guests}
        players={players}
        value={draft}
        onChange={setDraft}
        empty="Everyone plays"
        disabled={saving}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="lg" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button size="lg" disabled={unchanged} isPending={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </>
  )
}
