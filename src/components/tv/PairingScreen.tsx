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
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-12 overflow-hidden px-[5vw] py-[5vh] text-center short:gap-8">
      <Backdrop />
      <div className="flex max-w-full flex-col items-center gap-6 short:gap-4">
        <Logo className="size-24 ring-0 short:size-18" />
        <h1 className="max-w-[80rem] wide text-tv-question text-balance break-words text-paper short:text-tv-answer">{partyName}</h1>
      </div>

      <form onSubmit={submit} className="flex flex-col items-center gap-8 short:gap-6">
        <p className="flex items-center gap-4 text-tv-name font-bold text-paper short:text-tv-band">
          <TelevisionSimpleIcon weight="fill" className="shrink-0 text-paper-2" />
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
                // A field's edge is found before it is focused (docs/identity.md, Primitives):
                // paper-3 on the overlay box, paper once filled, gold where the next character goes.
                <span
                  key={i}
                  className={cn(
                    'relative grid h-28 w-22 place-items-center rounded-tile border-[3px] bg-overlay font-mono text-tv-answer font-extrabold text-paper transition-colors short:h-24 short:w-19 short:text-tv-score',
                    error ? 'border-paper' : active ? 'border-gold' : code[i] ? 'border-paper-2' : 'border-paper-3/60',
                  )}
                >
                  {code[i] ?? ''}
                  {active && !code[i] && <span className="absolute h-14 w-1 animate-pulse bg-gold motion-reduce:animate-none short:h-12" />}
                </span>
              )
            })}
          </span>
        </label>

        <p
          id="pairing-help"
          role={error ? 'alert' : undefined}
          className={cn('min-h-10 text-tv-tab short:text-tv-floor', error ? 'font-semibold text-paper' : 'text-paper-2')}
        >
          {error ??
            (state === 'paired' ? (
              <span className="flex items-center gap-3 font-semibold text-paper">
                <CheckCircleIcon weight="fill" className="shrink-0" />
                Paired. Opening the party…
              </span>
            ) : state === 'pairing' ? (
              'Pairing…'
            ) : (
              'On the host page, tap Pair a TV and type the code shown there.'
            ))}
        </p>

        <Button type="submit" className="h-16 min-w-64 rounded-tile px-10 text-tv-tab short:h-14 short:text-tv-floor" disabled={busy || code.length !== CODE_LENGTH}>
          Pair
        </Button>
      </form>
    </main>
  )
}
