import { ArrowLeftIcon, KeyIcon, SpinnerIcon, UserIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import Avatar from '@/components/Avatar'
import { Notice, Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { isBusyError, useBusySignIn } from '@/components/phone/busy'
import BusyScreen from '@/components/phone/BusyScreen'
import ClaimCodeForm from '@/components/phone/ClaimCodeForm'
import { couldBeClaimCode } from '@/components/phone/text'
import AddPhotoStep from '@/components/photos/AddPhotoStep'
import QueryGate from '@/components/QueryGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GameCallError } from '@/lib/gameApi'
import { joinSession, loadMembership, sessionByCode } from '@/lib/queries'
import { forgetJoinCode, rememberJoinCode } from '@/lib/storage'
import type { PublicSession } from '@/lib/types'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { joinScreen, type Joined } from '@/pages/joinScreen'
import { PartyNotFound, WayBack } from '@/pages/NotFound'

/** While joining is closed, the party is looked up this often, so the form appears as soon as the host opens it. */
const CLOSED_POLL_MS = 5000

/**
 * Joining a party (docs/engine-v2.md, 7.1): pick a name, or move your player
 * to this phone with a code from the host. A browser that already has a
 * player here goes straight to the phone home. The guest who just joined here
 * gets the Add a photo step first (docs/guest-photos.md, 6.1), held here,
 * above the membership reload, so coming back from the camera never skips it.
 */
export default function Join() {
  const code = (useParams().joinCode ?? '').toUpperCase()
  const { busy, signIn } = useBusySignIn()
  const load = useCallback(async () => {
    await signIn()
    return loadMembership(code)
  }, [code, signIn])
  const membership = useLiveQuery(load)
  const navigate = useNavigate()
  const [joined, setJoined] = useState<Joined | null>(null)
  const screen = joinScreen(joined, membership.data === undefined && (busy || isBusyError(membership.error)))

  if (screen.kind === 'step') {
    const { party, player } = screen.joined
    return <AddPhotoStep party={party} player={player} onDone={() => navigate(`/play/${party.join_code}`, { replace: true })} />
  }
  if (screen.kind === 'busy') return <BusyScreen />
  return (
    <QueryGate query={membership} notFound={<JoinNotFound code={code} />}>
      {({ session, player }) =>
        player ? <Navigate to={`/play/${session.join_code}`} replace /> : <JoinGate key={session.id} party={session} onJoined={setJoined} />
      }
    </QueryGate>
  )
}

/** The party as found: over, closed (waiting for the host), or open; or the code form. */
function JoinGate({ party, onJoined }: { party: PublicSession; onJoined: (joined: Joined) => void }) {
  const [claiming, setClaiming] = useState(false)
  const claim = useCallback(() => setClaiming(true), [])

  if (claiming) return <ClaimScreen party={party} onBack={() => setClaiming(false)} />
  if (party.archived_at !== null) return <PartyOver party={party} />
  if (party.status !== 'open') return <WhileClosed party={party} onClaim={claim} onJoined={onJoined} />
  return <JoinForm party={party} onClaim={claim} onJoined={onJoined} />
}

/** "Joining is closed", looking again every 5 s: the form appears as soon as the host opens joining. */
function WhileClosed({
  party,
  onClaim,
  onJoined,
}: {
  party: PublicSession
  onClaim: () => void
  onJoined: (joined: Joined) => void
}) {
  const poll = useCallback(() => sessionByCode(party.join_code), [party.join_code])
  const { data } = useLiveQuery(poll, { pollMs: CLOSED_POLL_MS })
  const fresh = data === undefined ? party : data

  if (fresh === null) return <JoinNotFound code={party.join_code} />
  if (fresh.archived_at !== null) return <PartyOver party={fresh} />
  if (fresh.status === 'open') return <JoinForm party={fresh} onClaim={onClaim} onJoined={onJoined} />
  return (
    <Notice
      title="Joining is closed"
      actions={
        <>
          <Button size="xl" variant="secondary" onClick={onClaim}>
            <KeyIcon />
            Got a code from the host?
          </Button>
          <WayBack back="party" variant="secondary" />
        </>
      }
    >
      Ask the host to open {fresh.name} for new players. This page lets you in as soon as they do.
    </Notice>
  )
}

function PartyOver({ party }: { party: PublicSession }) {
  return (
    <Notice title="This party is over" actions={<WayBack back="party" />}>
      {party.name} has ended. Thanks for coming!
    </Notice>
  )
}

function JoinForm({
  party,
  onClaim,
  onJoined,
}: {
  party: PublicSession
  onClaim: () => void
  onJoined: (joined: Joined) => void
}) {
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<Error>()
  // The join function's refusal for a name someone already has: maybe it's them, on a new phone.
  const taken = error instanceof GameCallError && error.code === 'name_taken'

  async function join() {
    setJoining(true)
    setError(undefined)
    try {
      const player = await joinSession(party.join_code, name)
      rememberJoinCode(party.join_code)
      onJoined({ party, player })
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)))
      setJoining(false)
    }
  }

  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      <Logo className="size-16" />
      <p className="mt-6 text-muted-foreground">You're joining</p>
      <h1 className="text-3xl font-bold text-balance">{party.name}</h1>

      <form
        className="mt-8 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!joining && name.trim()) void join()
        }}
      >
        <Label htmlFor="name">What should we call you?</Label>
        <div className="flex items-center gap-3">
          <NamePreview name={name} />
          <Input
            id="name"
            className="h-12 text-lg md:text-lg"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(undefined)
            }}
            maxLength={40}
            autoComplete="nickname"
            autoFocus
            required
            aria-invalid={error !== undefined}
            aria-describedby={error ? 'join-error' : undefined}
          />
        </div>
        {error && (
          <p id="join-error" role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        {taken && (
          <button
            type="button"
            onClick={onClaim}
            className="text-left text-sm text-muted-foreground underline-offset-4 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          >
            Is that you on another phone? <span className="font-semibold text-primary underline">Ask the host for a code.</span>
          </button>
        )}
        <Button type="submit" size="xl" className="mt-1" disabled={!name.trim()} isPending={joining}>
          {joining && <SpinnerIcon className="animate-spin" />}
          {joining ? 'Joining…' : "Let's go"}
        </Button>
      </form>

      {!taken && (
        <Button variant="ghost" size="lg" className="mt-4 self-center text-muted-foreground" onClick={onClaim}>
          <KeyIcon />
          Got a code from the host?
        </Button>
      )}
    </Screen>
  )
}

/** Your initials as the others will see them, coloured by the name, as you type it. */
function NamePreview({ name }: { name: string }) {
  const trimmed = name.trim()
  if (!trimmed) {
    return (
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
        <UserIcon weight="duotone" className="size-6" />
      </span>
    )
  }
  return <Avatar name={trimmed} className="size-12 text-lg transition-colors" />
}

/**
 * The host's code moves a player to this phone. Also reached from "Party not
 * found" when the code typed as a party code looks like one of the host's
 * (`initialCode`): the party is then unknown until the code finds it.
 */
function ClaimScreen({ party, initialCode, onBack }: { party?: PublicSession; initialCode?: string; onBack: () => void }) {
  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      <Logo className="size-16" />
      <p className="mt-6 text-muted-foreground">{party ? 'Move your player to this phone' : 'Got a code from the host?'}</p>
      <h1 className="text-3xl font-bold text-balance">{party ? party.name : 'Move your player to this phone'}</h1>
      <div className="mt-8">
        <ClaimCodeForm here={party} initialCode={initialCode} />
      </div>
      <Button variant="ghost" size="lg" className="mt-4 self-center text-muted-foreground" onClick={onBack}>
        <ArrowLeftIcon />
        {party ? 'Join with a name instead' : 'Back'}
      </Button>
    </Screen>
  )
}

/**
 * No party has this code. Guests told to "type this code" sometimes type the
 * host's 6-character code for moving their player where the party code goes,
 * so a code that could be one gets that way on too.
 */
function JoinNotFound({ code }: { code: string }) {
  const [claiming, setClaiming] = useState(false)
  useEffect(() => forgetJoinCode(code), [code])

  if (claiming) return <ClaimScreen initialCode={code} onBack={() => setClaiming(false)} />
  if (!couldBeClaimCode(code)) return <PartyNotFound code={code} />
  return (
    <Notice
      title="Party not found"
      actions={
        <>
          <WayBack back="party" />
          <Button size="xl" variant="secondary" onClick={() => setClaiming(true)}>
            <KeyIcon />
            It's a code from the host
          </Button>
        </>
      }
    >
      There's no party with the code {code}. If the host gave you this code to move your player to this phone, use it
      here.
    </Notice>
  )
}
