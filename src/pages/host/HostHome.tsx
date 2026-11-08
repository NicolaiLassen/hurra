import { CaretDownIcon, CaretRightIcon, PlusIcon, SpinnerIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from '@/lib/toast'
import { Screen } from '@/components/layout'
import StatusBadge from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSessions } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import type { Session } from '@/lib/types'
import SessionMenu from '@/pages/host/SessionMenu'

export default function HostHome() {
  const navigate = useNavigate()
  const { data: sessions, error } = useSessions()
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeError, setCodeError] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)
  const current = sessions?.filter((s) => !s.archived_at) ?? []
  const archived = sessions?.filter((s) => s.archived_at) ?? []

  async function create() {
    setBusy(true)
    const code = joinCode.trim().toUpperCase()
    const { data, error } = await supabase
      .from('sessions')
      .insert({ name: name.trim(), ...(code ? { join_code: code } : {}) })
      .select('id')
      .single()
    setBusy(false)
    if (error?.code === '23505') {
      // The join code field is the one to fix, so say it there.
      setCodeError(`${code} is already taken. Try another code, or leave it empty.`)
      return
    }
    if (error) {
      toast.error(error.message)
      return
    }
    navigate(`/host/s/${data.id}`)
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
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Birthday party"
                maxLength={80}
                required
              />
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
            <Button
              type="submit"
              size="lg"
              className="sm:col-start-3 sm:row-start-1"
              disabled={busy || !name.trim()}
            >
              {busy ? <SpinnerIcon className="animate-spin" /> : <PlusIcon />}
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="mt-6 text-destructive">{error.message}</p>}
      {sessions && current.length === 0 && (
        <p className="mt-6 text-muted-foreground">No sessions yet. Create one above.</p>
      )}
      {/* grid-cols-1: one column as wide as the page, so a long party name truncates instead of widening it. */}
      <ul className="mt-6 grid grid-cols-1 gap-2">
        {current.map((s) => (
          <SessionCard key={s.id} session={s} />
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
            <ul className="mt-2 grid grid-cols-1 gap-2 opacity-80">
              {archived.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Screen>
  )
}

function SessionCard({ session }: { session: Session }) {
  return (
    <li>
      <Card size="sm" className="transition-colors has-[a:hover]:ring-primary/50">
        <CardContent className="flex items-center gap-2">
          <Link to={`/host/s/${session.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <span className="truncate text-base font-semibold">{session.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-muted-foreground">{session.join_code}</span>
              <StatusBadge status={session.archived_at ? 'archived' : session.status} />
            </span>
          </Link>
          <SessionMenu session={session} />
        </CardContent>
      </Card>
    </li>
  )
}
