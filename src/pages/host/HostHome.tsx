import { CaretDownIcon, CaretRightIcon, PlusIcon } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import StateChip from '@/components/host/StateChip'
import { errorMessage } from '@/components/host/hostCalls'
import { Screen } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GameCallError } from '@/lib/gameApi'
import { createSession, useSessions } from '@/lib/queries'
import { toast } from '@/lib/toast'
import type { HostSessionRow } from '@/lib/types'
import SessionMenu, { type SessionChange } from '@/pages/host/SessionMenu'

/** The host's sessions: a new one, the current ones and the archive. */
export default function HostHome() {
  const navigate = useNavigate()
  const { data: sessions, error } = useSessions()
  // The list reads every 30 s; a change made here shows at once, until the next read has it.
  const [changes, setChanges] = useState<{ rows: HostSessionRow[] | undefined; byId: Record<string, SessionChange> }>({
    rows: undefined,
    byId: {},
  })
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeError, setCodeError] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)

  const rows = useMemo(() => {
    // Changes made before the last read are in it already.
    const byId = changes.rows === sessions ? changes.byId : {}
    return (sessions ?? []).flatMap((row) => {
      const change = byId[row.id]
      if (!change) return [row]
      if (change.deleted) return []
      return [
        {
          ...row,
          ...(change.name !== undefined ? { name: change.name } : {}),
          ...(change.status !== undefined ? { status: change.status } : {}),
          ...(change.archived !== undefined ? { archived_at: change.archived ? (row.archived_at ?? new Date(0).toISOString()) : null } : {}),
        },
      ]
    })
  }, [sessions, changes])
  const current = rows.filter((s) => !s.archived_at)
  const archived = rows.filter((s) => s.archived_at)

  // The list as last read, for a change made later from a toast's Undo, after another read landed.
  const latest = useRef(sessions)
  useEffect(() => {
    latest.current = sessions
  })

  function changed(id: string, change: SessionChange) {
    setChanges((now) => {
      const rows = latest.current
      const base = now.rows === rows ? now.byId : {}
      return { rows, byId: { ...base, [id]: { ...base[id], ...change } } }
    })
  }

  async function create() {
    setBusy(true)
    setCodeError(undefined)
    try {
      const { id } = await createSession(name, joinCode)
      navigate(`/host/s/${id}`)
    } catch (caught) {
      // A taken or malformed join code is the field to fix, so it says so there.
      if (caught instanceof GameCallError && (caught.code === 'join_code_taken' || caught.code === 'bad_code')) setCodeError(caught.message)
      else toast.error(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Screen wide>
      <h1 className="text-3xl font-bold">Sessions</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>New session</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Birthday party" maxLength={80} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="join-code">Join code (optional)</Label>
              <Input
                id="join-code"
                className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value)
                  setCodeError(undefined)
                }}
                placeholder="Random"
                pattern="[A-Za-z0-9]{4,12}"
                title="4 to 12 letters or digits"
                aria-invalid={!!codeError}
                aria-describedby={codeError ? 'join-code-error' : undefined}
              />
            </div>
            {/* Under the code field: before Create on a phone, on its own row under it on wider screens. */}
            {codeError && (
              <p id="join-code-error" className="text-sm text-destructive sm:col-start-2 sm:row-start-2">
                {codeError}
              </p>
            )}
            <Button type="submit" size="lg" className="sm:col-start-3 sm:row-start-1" disabled={!name.trim()} isPending={busy}>
              <PlusIcon />
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && !sessions && <p className="mt-6 text-destructive">{error.message}</p>}
      {sessions && current.length === 0 && <p className="mt-6 text-muted-foreground">No sessions yet. Create one above.</p>}
      {/* grid-cols-1: one column as wide as the page, so a long party name truncates instead of widening it. */}
      <ul className="mt-6 grid grid-cols-1 gap-2">
        {current.map((s) => (
          <SessionCard key={s.id} session={s} onChanged={(change) => changed(s.id, change)} />
        ))}
      </ul>

      {archived.length > 0 && (
        <div className="mt-6">
          <Button
            variant="ghost"
            className="-ml-2.5 text-muted-foreground"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((open) => !open)}
          >
            {showArchived ? <CaretDownIcon /> : <CaretRightIcon />}
            Archived ({archived.length})
          </Button>
          {showArchived && (
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {archived.map((s) => (
                <SessionCard key={s.id} session={s} onChanged={(change) => changed(s.id, change)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Screen>
  )
}

function SessionCard({ session, onChanged }: { session: HostSessionRow; onChanged: (change: SessionChange) => void }) {
  return (
    <li>
      <Card size="sm" className="transition-colors has-[a:hover]:bg-overlay">
        <CardContent className="flex items-center gap-2">
          <Link to={`/host/s/${session.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <span className="truncate text-base font-bold">{session.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono font-bold text-paper-2">{session.join_code}</span>
              <StateChip state={session.archived_at ? 'archived' : session.status} />
            </span>
          </Link>
          <SessionMenu session={session} onChanged={onChanged} />
        </CardContent>
      </Card>
    </li>
  )
}
