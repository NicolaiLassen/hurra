import { ArrowLeftIcon, ArrowUUpLeftIcon, KeyIcon, SpinnerIcon, UserIcon, WarningIcon } from '@phosphor-icons/react'
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import Avatar from '@/components/Avatar'
import { Loading, Notice, Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { isBusyError, useBusySignIn } from '@/components/phone/busy'
import BusyScreen from '@/components/phone/BusyScreen'
import ClaimCodeForm from '@/components/phone/ClaimCodeForm'
import { couldBeClaimCode } from '@/components/phone/text'
import { ConfirmName, JoinNote, WhoAreYou } from '@/components/phone/WhoAreYou'
import AddPhotoStep from '@/components/photos/AddPhotoStep'
import QueryGate from '@/components/QueryGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GameCallError } from '@/lib/gameApi'
import { claimGuest, freeGuestNames, joinSession, loadMembership, OnListError, sessionByCode } from '@/lib/queries'
import { forgetJoinCode, rememberJoinCode } from '@/lib/storage'
import type { PlayerRow, PublicSession } from '@/lib/types'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { freedNameOf, freedNote, joinScreen, openScreen, type Joined } from '@/pages/joinScreen'
import { PartyNotFound, WayBack } from '@/pages/NotFound'

/** While joining is closed, the party is looked up this often, so the form appears as soon as the host opens it. */
const CLOSED_POLL_MS = 5000
/** While Who are you? shows, the free names are read again this often, so names others took drop out. */
const NAMES_POLL_MS = 15_000

// Dev builds only: ?fixture=guests shows Who are you? on a sample guest list with no network (docs/guest-list.md, 6.7).
const JoinFixture = import.meta.env.DEV ? lazy(() => import('@/pages/JoinFixture')) : null

/** What the open party's screens send: the live calls, or the dev fixture's stand-ins. */
export type JoinCalls = {
  /** The party's free names; empty for a party without a list, and on any failure. */
  loadNames: (joinCode: string) => Promise<string[]>
  /** A typed name (join_session); an OnListError for a free listed one. */
  join: (joinCode: string, name: string) => Promise<PlayerRow>
  /** A name on the list (claim_guest). */
  claim: (joinCode: string, name: string) => Promise<PlayerRow>
}
const LIVE_CALLS: JoinCalls = { loadNames: freeGuestNames, join: joinSession, claim: claimGuest }

/**
 * Joining a party (docs/engine-v2.md, 7.1, and docs/guest-list.md, 6): tap
 * your name on the host's guest list, or type one, or move your player to this
 * phone with a code from the host. A browser that already has a player here
 * goes straight to the phone home. The guest who just joined here gets the Add
 * a photo step first (docs/guest-photos.md, 6.1), held here, above the
 * membership reload, so coming back from the camera never skips it.
 */
export default function Join() {
  const [params] = useSearchParams()
  if (JoinFixture && params.get('fixture') === 'guests') {
    return (
      <Suspense fallback={<Loading />}>
        <JoinFixture count={params.has('names') ? Number(params.get('names')) : 16} freed={params.get('freed')} />
      </Suspense>
    )
  }
  return <LiveJoin />
}

function LiveJoin() {
  const code = (useParams().joinCode ?? '').toUpperCase()
  // The phone home sends a phone whose name the host freed here with that name (6.6).
  const freed = freedNameOf(useLocation().state)
  const { busy, signIn } = useBusySignIn()
  const load = useCallback(async () => {
    await signIn()
    return loadMembership(code)
  }, [code, signIn])
  const membership = useLiveQuery(load)
  const navigate = useNavigate()
  const [joined, setJoined] = useState<Joined | null>(null)
  const onJoined = useCallback((next: Joined) => {
    rememberJoinCode(next.party.join_code)
    setJoined(next)
  }, [])
  const screen = joinScreen(joined, membership.data === undefined && (busy || isBusyError(membership.error)))

  if (screen.kind === 'step') {
    const { party, player } = screen.joined
    return <AddPhotoStep party={party} player={player} onDone={() => navigate(`/play/${party.join_code}`, { replace: true })} />
  }
  if (screen.kind === 'busy') return <BusyScreen />
  return (
    <QueryGate query={membership} notFound={<JoinNotFound code={code} />}>
      {({ session, player }) =>
        player ? (
          <Navigate to={`/play/${session.join_code}`} replace />
        ) : (
          <JoinGate key={session.id} party={session} freed={freed} onJoined={onJoined} onPartyChanged={membership.retry} />
        )
      }
    </QueryGate>
  )
}

type GateProps = {
  party: PublicSession
  /** The name the host gave back to the list, when that brought this phone here. */
  freed: string | null
  onJoined: (joined: Joined) => void
  /** Read the party again: a claim found joining closed or the party over. */
  onPartyChanged: () => void
}

/** The party as found: over, closed (waiting for the host), or open; or the code form. */
function JoinGate({ party, freed, onJoined, onPartyChanged }: GateProps) {
  const [claiming, setClaiming] = useState(false)
  const claim = useCallback(() => setClaiming(true), [])

  if (claiming) return <ClaimScreen party={party} onBack={() => setClaiming(false)} />
  if (party.archived_at !== null) return <PartyOver party={party} />
  if (party.status !== 'open') {
    return <WhileClosed party={party} freed={freed} onClaim={claim} onJoined={onJoined} onPartyChanged={onPartyChanged} />
  }
  return <JoinOpen party={party} freed={freed} onClaimCode={claim} onJoined={onJoined} onPartyChanged={onPartyChanged} />
}

/** "Joining is closed", looking again every 5 s: the way in appears as soon as the host opens joining. */
function WhileClosed({ party, freed, onClaim, onJoined, onPartyChanged }: GateProps & { onClaim: () => void }) {
  const poll = useCallback(() => sessionByCode(party.join_code), [party.join_code])
  const { data } = useLiveQuery(poll, { pollMs: CLOSED_POLL_MS })
  const fresh = data === undefined ? party : data

  if (fresh === null) return <JoinNotFound code={party.join_code} />
  if (fresh.archived_at !== null) return <PartyOver party={fresh} />
  if (fresh.status === 'open') {
    return <JoinOpen party={fresh} freed={freed} onClaimCode={onClaim} onJoined={onJoined} onPartyChanged={onPartyChanged} />
  }
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
      {party.name} has ended. Thanks for coming.
    </Notice>
  )
}

/**
 * An open party (docs/guest-list.md, 6): Who are you? when the host listed
 * names nobody has taken yet, You're Ana? for the name tapped, and the name
 * form for a party without a list or a guest who isn't on it. Taking a name
 * is joining; a refused take goes back to the list with why, or reads the
 * party again when joining closed meanwhile.
 */
export function JoinOpen({
  party,
  freed,
  calls = LIVE_CALLS,
  onClaimCode,
  onJoined,
  onPartyChanged,
}: {
  party: PublicSession
  freed: string | null
  calls?: JoinCalls
  onClaimCode: () => void
  onJoined: (joined: Joined) => void
  onPartyChanged: () => void
}) {
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [query, setQuery] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  // Bumped after a refused take, so the list is read again at once (keeping what is on screen meanwhile).
  const [revision, setRevision] = useState(0)
  const [polling, setPolling] = useState(false)
  const load = useCallback(() => calls.loadNames(party.join_code), [calls, party.join_code])
  const names = useLiveQuery(load, { pollMs: polling ? NAMES_POLL_MS : undefined, revision })
  const screen = openScreen(names.data, chosen, typing)
  // Poll only while the list shows: a guest typing a name never sees the screen change under them.
  if ((screen.kind === 'list') !== polling) setPolling(screen.kind === 'list')

  /** Takes a name on the list. Resolves with words to show, or null once the page has moved on. */
  const take = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const player = await calls.claim(party.join_code, name)
        onJoined({ party, player })
        return null
      } catch (failure) {
        const error = failure instanceof Error ? failure : new Error(String(failure))
        const code = error instanceof GameCallError ? error.code : ''
        if (code === 'guest_taken' || code === 'not_on_list') {
          setRefusal(error.message)
          setChosen(null)
          setTyping(false)
          setRevision((n) => n + 1)
          return null
        }
        // Joined already (another tab): the phone home.
        if (code === 'already_player') {
          navigate(`/play/${party.join_code}`, { replace: true })
          return null
        }
        if (code === 'closed' || code === 'archived') {
          onPartyChanged()
          return null
        }
        return error.message
      }
    },
    [calls, navigate, onJoined, onPartyChanged, party],
  )

  const freedLine = freed && <JoinNote icon={ArrowUUpLeftIcon}>{freedNote(freed)}</JoinNote>
  if (screen.kind === 'loading') return <Loading />
  if (screen.kind === 'confirm') {
    return <ConfirmName key={screen.name} name={screen.name} onConfirm={() => take(screen.name)} onBack={() => setChosen(null)} />
  }
  if (screen.kind === 'list') {
    return (
      <WhoAreYou
        party={party}
        names={screen.names}
        notes={
          <>
            {freedLine}
            {refusal && <JoinNote icon={WarningIcon}>{refusal}</JoinNote>}
          </>
        }
        query={query}
        onQuery={setQuery}
        onChoose={(name) => {
          setRefusal(null)
          setChosen(name)
        }}
        onNotOnList={() => {
          setRefusal(null)
          setTyping(true)
        }}
        onClaimCode={onClaimCode}
      />
    )
  }
  return (
    <JoinForm
      party={party}
      note={freedLine}
      join={calls.join}
      take={take}
      onBackToList={screen.backToList ? () => setTyping(false) : undefined}
      onClaim={onClaimCode}
      onJoined={onJoined}
    />
  )
}

/**
 * The name form (docs/guest-list.md, 6.4 and 6.5): today's, plus Back to the
 * list for a guest who came from Who are you?, and the offer of a listed name
 * that matches the one typed ("Yes, I'm Ana"), which takes it.
 */
function JoinForm({
  party,
  note,
  join,
  take,
  onBackToList,
  onClaim,
  onJoined,
}: {
  party: PublicSession
  note?: ReactNode
  join: JoinCalls['join']
  take: (name: string) => Promise<string | null>
  onBackToList?: () => void
  onClaim: () => void
  onJoined: (joined: Joined) => void
}) {
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<Error>()
  // A listed name that matches the one typed: the gold button takes it.
  const [offer, setOffer] = useState<string | null>(null)
  // The join function's refusal for a name someone already has: maybe it's them, on a new phone.
  const taken = error instanceof GameCallError && error.code === 'name_taken'

  async function submit() {
    setJoining(true)
    setError(undefined)
    if (offer !== null) {
      const refused = await take(offer)
      if (refused !== null) {
        setError(new Error(refused))
        setJoining(false)
      }
      return
    }
    try {
      const player = await join(party.join_code, name)
      onJoined({ party, player })
    } catch (failure) {
      if (failure instanceof OnListError) setOffer(failure.listedName)
      else setError(failure instanceof Error ? failure : new Error(String(failure)))
      setJoining(false)
    }
  }

  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      <Logo className="size-16" />
      <p className="mt-6 text-muted-foreground">You're joining</p>
      <h1 className="text-3xl font-bold text-balance">{party.name}</h1>
      {note}
      {onBackToList && (
        <Button variant="ghost" size="lg" className="mt-6 -ml-2 self-start text-paper-2" onClick={onBackToList}>
          <ArrowLeftIcon />
          Back to the list
        </Button>
      )}

      <form
        className={onBackToList ? 'mt-4 grid gap-3' : 'mt-8 grid gap-3'}
        onSubmit={(event) => {
          event.preventDefault()
          if (!joining && name.trim()) void submit()
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
              setOffer(null)
            }}
            maxLength={40}
            autoComplete="nickname"
            autoFocus
            required
            aria-invalid={error !== undefined}
            aria-describedby={error ? 'join-error' : offer !== null ? 'join-offer' : undefined}
          />
        </div>
        {offer !== null && (
          <p id="join-offer" className="text-paper-2">
            {offer} is on the guest list.
          </p>
        )}
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
        <Button
          type="submit"
          size="xl"
          className="mt-1 h-auto min-h-13.5 py-3 whitespace-normal"
          disabled={!name.trim()}
          isPending={joining}
        >
          {joining && <SpinnerIcon className="animate-spin" />}
          {joining ? 'Joining…' : offer !== null ? `Yes, I'm ${offer}` : "Let's go"}
        </Button>
        {offer !== null && (
          <p className="text-sm text-paper-2">Not you? Change the name, for example with the first letter of your last name.</p>
        )}
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

/** Your token as the others will see it, in the colour and piece your name gives you, as you type it. */
function NamePreview({ name }: { name: string }) {
  const trimmed = name.trim()
  if (!trimmed) {
    return (
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-token bg-secondary text-muted-foreground">
        <UserIcon weight="duotone" className="size-6" />
      </span>
    )
  }
  return <Avatar name={trimmed} className="size-12 transition-colors" />
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
