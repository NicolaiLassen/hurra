import { SpinnerIcon } from '@phosphor-icons/react'
import { useCallback, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Notice, Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import QueryGate from '@/components/QueryGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loadMembership } from '@/lib/queries'
import { rememberJoinCode } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import type { Session } from '@/lib/types'
import { isJoinCode } from '@/lib/urls'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { PartyNotFound, WayBack } from '@/pages/NotFound'

export default function Join() {
  const code = (useParams().joinCode ?? '').toUpperCase()
  const load = useCallback(() => loadMembership(code), [code])
  // Live, so the form appears as soon as the host opens joining.
  const membership = useLiveQuery(load, isJoinCode(code) ? [{ table: 'sessions', filter: `join_code=eq.${code}` }] : [])

  return (
    <QueryGate query={membership} notFound={<PartyNotFound code={code} />}>
      {({ session, player }) => {
        if (player) return <Navigate to={`/play/${code}`} replace />
        if (session.archived_at) {
          return (
            <Notice title="This party is over" actions={<WayBack back="party" />}>
              {session.name} has ended. Thanks for coming!
            </Notice>
          )
        }
        if (session.status !== 'open') {
          return (
            <Notice title="Joining is closed" actions={<WayBack back="party" variant="secondary" />}>
              Ask the host to open {session.name} for new players. This page lets you in as soon as they do.
            </Notice>
          )
        }
        return <JoinForm session={session} code={code} />
      }}
    </QueryGate>
  )
}

function JoinForm({ session, code }: { session: Session; code: string }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState<string>()

  async function join() {
    setBusy(true)
    setJoinError(undefined)
    const { error } = await supabase.rpc('join_session', { p_join_code: code, p_name: name })
    if (error) {
      setJoinError(error.message)
      setBusy(false)
      return
    }
    rememberJoinCode(code)
    navigate(`/play/${code}`, { replace: true })
  }

  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      <Logo className="size-16" />
      <p className="mt-6 text-muted-foreground">You're joining</p>
      <h1 className="text-3xl font-bold">{session.name}</h1>

      <form
        className="mt-8 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void join()
        }}
      >
        <Label htmlFor="name">What should we call you?</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="nickname"
          autoFocus
          required
          aria-invalid={!!joinError}
        />
        {joinError && <p className="text-sm text-destructive">{joinError}</p>}
        {/* The join function's message for a taken name. A different browser is a different player. */}
        {joinError?.includes('already joined as') && (
          <p className="text-sm text-muted-foreground">
            Is that you on another phone or browser? Open the game there, or ask the host.
          </p>
        )}
        <Button type="submit" size="xl" disabled={busy || !name.trim()}>
          {busy && <SpinnerIcon className="animate-spin" />}
          {busy ? 'Joining…' : "Let's go"}
        </Button>
      </form>
    </Screen>
  )
}
