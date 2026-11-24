import { SpinnerIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CLAIM_CODE_LENGTH, cleanClaimCode } from '@/components/phone/text'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ensureSignedIn } from '@/lib/auth'
import { claimPlayer, getPlayerByCode } from '@/lib/queries'
import { rememberJoinCode } from '@/lib/storage'
import { toast } from '@/lib/toast'
import type { PublicSession } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * "Got a code from the host?" (docs/engine-v2.md, 7.1): the host's 6-character
 * code moves a guest's player, with all their points, to this phone. Then on
 * to the party's phone home. `here` is the party this page is about, if any:
 * the start page doesn't know it, so the party is looked up from the player.
 */
export default function ClaimCodeForm({
  here,
  initialCode = '',
  autoFocus = true,
}: {
  here?: PublicSession
  initialCode?: string
  autoFocus?: boolean
}) {
  const navigate = useNavigate()
  const [code, setCode] = useState(() => cleanClaimCode(initialCode))
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const complete = code.length === CLAIM_CODE_LENGTH

  async function claim() {
    setSending(true)
    setError(undefined)
    try {
      await ensureSignedIn({ onBusy: () => setBusy(true) })
      const player = await claimPlayer(code)
      const joinCode =
        here && player.session_id === here.id ? here.join_code : (await getPlayerByCode(player.code))?.session.join_code
      if (!joinCode) throw new Error("Your player is on this phone now, but its party didn't load. Open the party's join link.")
      rememberJoinCode(joinCode)
      toast.success(`Welcome back, ${player.name}.`, { description: 'Your points came with you.' })
      navigate(`/play/${joinCode}`, { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setSending(false)
      setBusy(false)
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete && !sending) void claim()
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="claim-code">Code from the host</Label>
        <CodeTiles
          id="claim-code"
          value={code}
          onChange={(next) => {
            setCode(next)
            setError(undefined)
          }}
          invalid={error !== undefined}
          disabled={sending}
          autoFocus={autoFocus}
          describedBy="claim-note"
        />
        {error ? (
          <p id="claim-note" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p id="claim-note" className="text-sm text-muted-foreground">
            The host can move your player to this phone, with all your points. Type the code they show you.
          </p>
        )}
      </div>
      <Button type="submit" size="xl" disabled={!complete} isPending={sending}>
        {sending && <SpinnerIcon className="animate-spin" />}
        {sending ? 'Moving your player…' : 'Move my player here'}
      </Button>
      {busy && <p className="text-center text-sm text-muted-foreground">Lots of guests arriving, one moment</p>}
    </form>
  )
}

/**
 * A code typed into tiles, one character each, like a TV pairing code. One
 * real input lies over the tiles, so typing, pasting, autofill and deleting
 * all work as in any field.
 */
function CodeTiles({
  id,
  value,
  onChange,
  invalid,
  disabled,
  autoFocus,
  describedBy,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
  disabled: boolean
  autoFocus: boolean
  describedBy: string
}) {
  const [focused, setFocused] = useState(false)
  // The tile the next character goes into; the last one once the code is full.
  const at = Math.min(value.length, CLAIM_CODE_LENGTH - 1)

  return (
    <div className="relative">
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {Array.from({ length: CLAIM_CODE_LENGTH }, (_, i) => {
          const char = value[i]
          const active = focused && i === at
          return (
            <span
              key={i}
              className={cn(
                'relative grid h-16 place-items-center rounded-xl bg-secondary font-mono text-3xl font-bold ring-1 ring-white/10 transition-shadow',
                char && 'bg-secondary/70',
                active && 'ring-2 ring-primary',
                invalid && 'ring-destructive/70',
                disabled && 'opacity-60',
              )}
            >
              {char}
              {active && !char && (
                <span className="absolute h-8 w-0.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
              )}
            </span>
          )
        })}
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(cleanClaimCode(event.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // 16 px text: phones don't zoom in on the field. The text itself is invisible; the tiles show it.
        className="absolute inset-0 size-full cursor-text rounded-xl border-0 bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-default"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        maxLength={CLAIM_CODE_LENGTH + 4}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </div>
  )
}
