import { CheckCircleIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { useRef, useState, type FormEvent } from 'react'
import Logo from '@/components/Logo'
import Backdrop from '@/components/tv/Backdrop'
import { cleanCode, CODE_LENGTH } from '@/components/tv/pairing'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The TV's pairing screen (docs/engine-v2.md, 7.2): the TV laptop isn't a host
 * and reads only what a guest reads, so the host pairs it with a 6-character
 * code from the host page. Six big character boxes over one real input: typing
 * the sixth character pairs at once, and a wrong or expired code shows the
 * server's words under the boxes.
 */
export default function PairingScreen({ partyName, onPair }: { partyName: string; onPair: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'pairing' | 'paired'>('idle')
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function pair(value: string) {
    if (value.length !== CODE_LENGTH || state !== 'idle') return
    setState('pairing')
    setError(null)
    try {
      await onPair(value)
      setState('paired')
    } catch (failure) {
      setState('idle')
      setError(failure instanceof Error ? failure.message : String(failure))
      // Ready to type the code again: typing replaces the wrong one.
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    }
  }

  function change(text: string) {
    const next = cleanCode(text)
    setCode(next)
    if (error) setError(null)
    if (next.length === CODE_LENGTH) void pair(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void pair(code)
  }

  const busy = state !== 'idle'

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-10 overflow-hidden p-10 text-center short:gap-8">
      <Backdrop />
      <div className="flex flex-col items-center gap-5 short:gap-4">
        <Logo className="size-24 short:size-20" />
        <h1 className="max-w-5xl text-6xl font-black tracking-tight text-balance short:text-5xl">{partyName}</h1>
      </div>

      <form onSubmit={submit} className="flex flex-col items-center gap-6 short:gap-5">
        <p className="flex items-center gap-3 text-3xl font-bold short:text-2xl">
          <TelevisionSimpleIcon weight="duotone" className="size-9 text-primary short:size-8" />
          Pair this screen
        </p>

        <label className="relative block cursor-text">
          <span className="sr-only">Pairing code</span>
          <input
            ref={input}
            value={code}
            onChange={(event) => change(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={busy}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={CODE_LENGTH + 4}
            aria-invalid={error ? true : undefined}
            aria-describedby="pairing-help"
            className="absolute inset-0 z-10 size-full cursor-text opacity-0"
          />
          <span aria-hidden className="flex gap-3 short:gap-2.5">
            {Array.from({ length: CODE_LENGTH }, (_, i) => {
              const active = focused && !busy && i === Math.min(code.length, CODE_LENGTH - 1)
              return (
                <span
                  key={i}
                  className={cn(
                    'relative grid h-28 w-22 place-items-center rounded-2xl bg-card/90 font-mono text-6xl font-black ring-2 transition-[box-shadow,color] short:h-24 short:w-19 short:text-5xl',
                    error ? 'ring-destructive/70' : active ? 'ring-primary' : code[i] ? 'ring-foreground/25' : 'ring-foreground/10',
                    state === 'paired' && 'text-confetti-teal ring-confetti-teal/70',
                  )}
                >
                  {code[i] ?? ''}
                  {active && !code[i] && <span className="absolute h-14 w-1 animate-pulse rounded-full bg-primary short:h-12" />}
                </span>
              )
            })}
          </span>
        </label>

        <p id="pairing-help" role={error ? 'alert' : undefined} className={cn('min-h-9 text-2xl short:text-xl', error ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
          {error ??
            (state === 'paired' ? (
              <span className="flex items-center gap-2 text-confetti-teal">
                <CheckCircleIcon weight="fill" />
                Paired. Opening the party…
              </span>
            ) : state === 'pairing' ? (
              'Pairing…'
            ) : (
              'On the host page, tap Pair a TV and type the code shown there.'
            ))}
        </p>

        <Button type="submit" size="xl" className="min-w-56 text-xl" disabled={busy || code.length !== CODE_LENGTH}>
          Pair
        </Button>
      </form>
    </main>
  )
}
